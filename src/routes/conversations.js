import express from 'express';
import pool from '../db.js';
import { protect } from '../middleware/auth.js';
import { containsContactInfo, CONTACT_BLOCKED_MESSAGE } from '../utils/chatGuard.js';

const router = express.Router();

const RESIDENT_STATUSES = ['approved', 'active', 'confirmed'];

async function tenantHasActiveStay(tenantId, propertyId) {
  const result = await pool.query(
    `SELECT id FROM tenant_bookings
     WHERE tenant_id = $1 AND property_id = $2 AND binding_state = 'linked'
     LIMIT 1`,
    [tenantId, propertyId]
  );
  return result.rows.length > 0;
}

async function syncConversationUnlock(tenantId, ownerId, propertyId) {
  const isResident = await tenantHasActiveStay(tenantId, propertyId);
  if (!isResident) return 'preset_only';

  await pool.query(
    `UPDATE conversations SET status = 'unlocked', updated_at = now()
     WHERE tenant_id = $1 AND owner_id = $2 AND property_id = $3`,
    [tenantId, ownerId, propertyId]
  );
  return 'unlocked';
}

// GET /api/conversations/templates
router.get('/templates', protect, async (req, res) => {
  const senderType = req.user.role === 'tenant' ? 'tenant' : 'owner';
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (trim(body)) id, label, body
       FROM message_templates
       WHERE is_active = true AND (sender_type = $1 OR sender_type = 'any')
       ORDER BY trim(body), created_at ASC`,
      [senderType]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch templates error:', err);
    return res.status(500).json({ error: 'Failed to load preset questions.' });
  }
});

// POST /api/conversations/start — open inquiry chat for a listing
router.post('/start', protect, async (req, res) => {
  const { property_id } = req.body;
  if (!property_id) {
    return res.status(400).json({ error: 'property_id is required.' });
  }

  try {
    const propResult = await pool.query(
      'SELECT id, owner_id, broker_id, title FROM properties WHERE id = $1',
      [property_id]
    );
    if (propResult.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const property = propResult.rows[0];
    const ownerId = property.owner_id;
    const brokerId = property.broker_id || null;

    if (!ownerId) {
      return res.status(400).json({ error: 'This listing has no owner assigned yet.' });
    }

    if (req.user.role !== 'tenant') {
      return res.status(403).json({ error: 'Only tenants can start listing inquiry chats.' });
    }

    const initialStatus = (await tenantHasActiveStay(req.user.id, property_id))
      ? 'unlocked'
      : 'preset_only';

    const upsert = await pool.query(
      `INSERT INTO conversations (tenant_id, owner_id, broker_id, property_id, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, owner_id, property_id)
       DO UPDATE SET updated_at = now()
       RETURNING *`,
      [req.user.id, ownerId, brokerId, property_id, initialStatus]
    );

    let conversation = upsert.rows[0];
    if (conversation.status === 'preset_only' && initialStatus === 'unlocked') {
      await pool.query(
        `UPDATE conversations SET status = 'unlocked' WHERE id = $1 RETURNING *`,
        [conversation.id]
      );
      conversation.status = 'unlocked';
    }

    return res.json({
      conversation: {
        ...conversation,
        property_title: property.title
      }
    });
  } catch (err) {
    console.error('Start conversation error:', err);
    return res.status(500).json({ error: 'Could not start chat.' });
  }
});

const CONVERSATION_LIST_EXTRA = `
  p.monthly_rent as property_rent,
  p.listing_type as property_listing_type,
  (
    SELECT pm.file_url FROM property_media pm
    WHERE pm.property_id = p.id AND pm.file_type = 'image'
    ORDER BY pm.sort_order ASC NULLS LAST, pm.created_at ASC
    LIMIT 1
  ) as property_image
`;

// GET /api/conversations — inbox (one thread per listing)
router.get('/', protect, async (req, res) => {
  try {
    const query = `
      SELECT c.*, p.title as property_title, p.city as property_city,
             ${CONVERSATION_LIST_EXTRA},
             t.full_name as tenant_name, t.avatar_url as tenant_avatar,
             o.full_name as owner_name, o.avatar_url as owner_avatar,
             CASE
               WHEN c.tenant_id = $1 THEN o.full_name
               ELSE t.full_name
             END as peer_name,
             CASE
               WHEN c.tenant_id = $1 THEN o.avatar_url
               ELSE t.avatar_url
             END as peer_avatar
      FROM conversations c
      JOIN properties p ON c.property_id = p.id
      JOIN profiles t ON c.tenant_id = t.id
      JOIN profiles o ON c.owner_id = o.id
      WHERE c.tenant_id = $1 OR c.owner_id = $1 OR c.broker_id = $1
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
    `;
    const result = await pool.query(query, [req.user.id]);

    const enriched = await Promise.all(
      result.rows.map(async (row) => {
        if (row.status === 'preset_only') {
          const unlocked = await syncConversationUnlock(row.tenant_id, row.owner_id, row.property_id);
          if (unlocked === 'unlocked') row.status = 'unlocked';
        }
        return row;
      })
    );

    return res.json(enriched);
  } catch (err) {
    console.error('Fetch chats error:', err);
    return res.status(500).json({ error: 'Failed to retrieve active chat conversations.' });
  }
});

// GET /api/conversations/:id
router.get('/:id', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const convResult = await pool.query(
      `SELECT c.*, p.title as property_title
       FROM conversations c
       JOIN properties p ON c.property_id = p.id
       WHERE c.id = $1`,
      [id]
    );
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const conv = convResult.rows[0];
    if (
      req.user.id !== conv.tenant_id &&
      req.user.id !== conv.owner_id &&
      req.user.id !== conv.broker_id
    ) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    if (conv.status === 'preset_only') {
      const status = await syncConversationUnlock(conv.tenant_id, conv.owner_id, conv.property_id);
      conv.status = status;
    }

    return res.json(conv);
  } catch (err) {
    console.error('Fetch conversation error:', err);
    return res.status(500).json({ error: 'Failed to load conversation.' });
  }
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const convCheck = await pool.query(
      'SELECT tenant_id, owner_id, broker_id, property_id, status FROM conversations WHERE id = $1',
      [id]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat conversation channel not found.' });
    }

    const conv = convCheck.rows[0];
    if (
      req.user.id !== conv.tenant_id &&
      req.user.id !== conv.owner_id &&
      req.user.id !== conv.broker_id
    ) {
      return res.status(403).json({ error: 'Not authorized to read messages from this channel.' });
    }

    if (conv.status === 'preset_only') {
      await syncConversationUnlock(conv.tenant_id, conv.owner_id, conv.property_id);
    }

    const messagesQuery = `
      SELECT cm.*, pr.full_name as sender_name, pr.role as sender_role, pr.avatar_url as sender_avatar
      FROM conversation_messages cm
      JOIN profiles pr ON cm.sender_id = pr.id
      WHERE cm.conversation_id = $1
      ORDER BY cm.created_at ASC
    `;
    const result = await pool.query(messagesQuery, [id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch chat elements error:', err);
    return res.status(500).json({ error: 'Failed to retrieve historic chat transcripts.' });
  }
});

// POST /api/conversations/:id/messages
router.post('/:id/messages', protect, async (req, res) => {
  const { id } = req.params;
  const { body, template_id } = req.body;

  if (!body || body.trim() === '') {
    return res.status(400).json({ error: 'Message text body is required.' });
  }

  const trimmedBody = body.trim();

  try {
    const convCheck = await pool.query(
      'SELECT tenant_id, owner_id, broker_id, property_id, status FROM conversations WHERE id = $1',
      [id]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat channel not found.' });
    }

    let conv = convCheck.rows[0];
    if (
      req.user.id !== conv.tenant_id &&
      req.user.id !== conv.owner_id &&
      req.user.id !== conv.broker_id
    ) {
      return res.status(403).json({ error: 'Unauthorized message transmission.' });
    }

    if (conv.status === 'preset_only') {
      const newStatus = await syncConversationUnlock(conv.tenant_id, conv.owner_id, conv.property_id);
      if (newStatus === 'unlocked') conv.status = 'unlocked';
    }

    if (conv.status === 'preset_only') {
      if (containsContactInfo(trimmedBody)) {
        return res.status(400).json({ error: CONTACT_BLOCKED_MESSAGE });
      }

      const senderType = req.user.role === 'tenant' ? 'tenant' : 'owner';
      let templateOk = false;

      if (template_id) {
        const tpl = await pool.query(
          `SELECT body FROM message_templates WHERE id = $1 AND is_active = true
           AND (sender_type = $2 OR sender_type = 'any')`,
          [template_id, senderType]
        );
        templateOk = tpl.rows.length > 0 && tpl.rows[0].body.trim() === trimmedBody;
      } else {
        const tpl = await pool.query(
          `SELECT id FROM message_templates WHERE is_active = true
           AND (sender_type = $1 OR sender_type = 'any') AND trim(body) = $2`,
          [senderType, trimmedBody]
        );
        templateOk = tpl.rows.length > 0;
      }

      if (!templateOk) {
        return res.status(400).json({
          error: 'Inquiry chat allows preset questions only. Pick a question from the list — no custom messages or contact sharing.'
        });
      }
    } else if (containsContactInfo(trimmedBody)) {
      return res.status(400).json({ error: CONTACT_BLOCKED_MESSAGE });
    }

    const insertQuery = `
      INSERT INTO conversation_messages (conversation_id, sender_id, sender_type, body, is_template)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const isTemplate = conv.status === 'preset_only';
    const result = await pool.query(insertQuery, [
      id,
      req.user.id,
      req.user.role,
      trimmedBody,
      isTemplate
    ]);
    const message = result.rows[0];

    await pool.query(
      'UPDATE conversations SET last_message = $1, last_message_at = now(), updated_at = now() WHERE id = $2',
      [trimmedBody, id]
    );

    const recipientId =
      req.user.id === conv.tenant_id
        ? conv.owner_id
        : conv.tenant_id;

    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'chat_message')`,
      [recipientId, `Message from ${req.user.full_name || 'User'}`, trimmedBody.substring(0, 60)]
    );

    return res.json({
      success: true,
      message: {
        ...message,
        sender_name: req.user.full_name || 'You'
      },
      conversation_status: conv.status
    });
  } catch (err) {
    console.error('Send message error:', err);
    return res.status(500).json({ error: 'Could not deliver the message.' });
  }
});

export { syncConversationUnlock, tenantHasActiveStay };
export default router;
