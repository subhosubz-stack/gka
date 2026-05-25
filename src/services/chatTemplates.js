import pool from '../db.js';

const TEMPLATES = [
  ['tenant', 'Is this property still available?', 'Is this property still available?'],
  ['tenant', 'What is the security deposit?', 'What is the security deposit?'],
  ['tenant', 'Can I schedule a visit?', 'Can I schedule a visit?'],
  ['tenant', 'Is food included?', 'Is food included?'],
  ['tenant', 'Can I move in this week?', 'Can I move in this week?'],
  ['owner', 'Yes, it is available.', 'Yes, it is available.'],
  ['owner', 'Please schedule a visit.', 'Please schedule a visit.'],
  ['owner', 'You can move in after verification.', 'You can move in after verification.']
];

export async function ensureChatTemplates() {
  try {
    const count = await pool.query(`SELECT COUNT(*)::int AS c FROM message_templates WHERE is_active = true`);
    if (count.rows[0].c > 0) return;
    for (const [sender_type, label, body] of TEMPLATES) {
      const exists = await pool.query(
        `SELECT 1 FROM message_templates WHERE sender_type = $1 AND body = $2 LIMIT 1`,
        [sender_type, body]
      );
      if (exists.rows.length) continue;
      await pool.query(
        `INSERT INTO message_templates (label, body, sender_type, is_active) VALUES ($1, $2, $3, true)`,
        [label, body, sender_type]
      );
    }
  } catch (err) {
    console.warn('[GKA] Chat templates seed skipped:', err.message);
  }
}
