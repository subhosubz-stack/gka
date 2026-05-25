import pool from '../db.js';
import { formatDisplayId, parseDisplayId } from '../utils/displayId.js';

export const BINDING_LINKED = 'linked';
export const BINDING_AWAITING_PAYMENT = 'awaiting_payment';
export const BINDING_AWAITING_OWNER = 'awaiting_owner';

export async function ensurePrimaryMember(bookingId, primaryTenantId, propertyId) {
  await pool.query(
    `INSERT INTO stay_members (booking_id, property_id, member_tenant_id, primary_tenant_id, is_primary, status)
     VALUES ($1, $2, $3, $3, true, 'active')
     ON CONFLICT (booking_id, member_tenant_id) DO NOTHING`,
    [bookingId, propertyId, primaryTenantId]
  );
}

export async function activateStayAfterPayment(bookingId, paymentId) {
  const bookingRes = await pool.query(
    `SELECT tb.*, p.capacity, p.title AS property_title
     FROM tenant_bookings tb
     JOIN properties p ON tb.property_id = p.id
     WHERE tb.id = $1`,
    [bookingId]
  );
  if (bookingRes.rows.length === 0) return null;

  const booking = bookingRes.rows[0];

  await pool.query(
    `UPDATE tenant_bookings
     SET status = 'active',
         binding_state = $1,
         payment_confirmed_at = NOW(),
         binding_payment_id = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [BINDING_LINKED, paymentId, bookingId]
  );

  await pool.query(
    `UPDATE properties SET availability_status = 'locked', updated_at = NOW() WHERE id = $1`,
    [booking.property_id]
  );

  await ensurePrimaryMember(booking.id, booking.tenant_id, booking.property_id);

  await pool.query(
    `INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message)
     VALUES ($1, $2, $3, 'unlocked', 'Stay linked after payment — full chat enabled')
     ON CONFLICT (tenant_id, owner_id, property_id)
     DO UPDATE SET status = 'unlocked', updated_at = NOW()`,
    [booking.tenant_id, booking.owner_id, booking.property_id]
  );

  await pool.query(
    `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'stay_linked')`,
    [
      booking.tenant_id,
      'Property linked successfully',
      `"${booking.property_title}" is now active on your Resident Dashboard. You can add room members up to the seat limit.`
    ]
  );

  await pool.query(
    `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'tenant_linked')`,
    [
      booking.owner_id,
      'Tenant payment received — stay linked',
      `Tenant ID ${formatDisplayId('tenant', booking.tenant_id)} completed binding payment for "${booking.property_title}".`
    ]
  );

  return booking;
}

export async function getPropertyCapacity(propertyId) {
  const r = await pool.query('SELECT capacity FROM properties WHERE id = $1', [propertyId]);
  return Math.max(1, parseInt(r.rows[0]?.capacity || 1, 10));
}

export async function countStayMembers(bookingId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM stay_members WHERE booking_id = $1 AND status = 'active'`,
    [bookingId]
  );
  return r.rows[0]?.c || 0;
}

export async function listStayMembers(bookingId) {
  const r = await pool.query(
    `SELECT sm.*, p.full_name, p.email, p.display_id, p.phone
     FROM stay_members sm
     JOIN profiles p ON sm.member_tenant_id = p.id
     WHERE sm.booking_id = $1
     ORDER BY sm.is_primary DESC, sm.created_at ASC`,
    [bookingId]
  );
  return r.rows;
}

export async function resolveTenantByDisplayId(displayIdInput) {
  const parsed = parseDisplayId(displayIdInput);
  if (!parsed || parsed.role !== 'tenant') {
    return { error: 'Enter a valid Tenant ID (format TNT-XXXXXXXX).' };
  }

  const byCol = await pool.query(
    `SELECT id, full_name, email, display_id, role FROM profiles
     WHERE UPPER(display_id) = $1 AND role = 'tenant' LIMIT 1`,
    [`${parsed.prefix}-${parsed.short}`]
  );
  if (byCol.rows.length) return { user: byCol.rows[0] };

  const tenants = await pool.query(`SELECT id, full_name, email, display_id, role FROM profiles WHERE role = 'tenant'`);
  const match = tenants.rows.find((u) => {
    const fid = formatDisplayId('tenant', u.id);
    return fid === `${parsed.prefix}-${parsed.short}` || u.id.replace(/-/g, '').toUpperCase().startsWith(parsed.short);
  });
  if (match) return { user: match };
  return { error: 'No tenant account found with this ID. Ask them to sign up and share their Tenant ID.' };
}

export async function addStayMember({ booking, primaryTenantId, memberDisplayId }) {
  if (booking.binding_state !== BINDING_LINKED) {
    return { error: 'Complete binding payment before adding members.' };
  }
  if (booking.tenant_id !== primaryTenantId) {
    return { error: 'Only the primary tenant can add members.' };
  }

  const capacity = await getPropertyCapacity(booking.property_id);
  const current = await countStayMembers(booking.id);
  if (current >= capacity) {
    return { error: `Seat limit reached (${capacity} members including you).` };
  }

  const resolved = await resolveTenantByDisplayId(memberDisplayId);
  if (resolved.error) return resolved;

  const member = resolved.user;
  if (member.id === primaryTenantId) {
    return { error: 'You are already the primary member on this stay.' };
  }

  const dup = await pool.query(
    `SELECT id FROM stay_members WHERE booking_id = $1 AND member_tenant_id = $2`,
    [booking.id, member.id]
  );
  if (dup.rows.length) {
    return { error: 'This tenant is already added to the stay.' };
  }

  await pool.query(
    `INSERT INTO stay_members (booking_id, property_id, member_tenant_id, primary_tenant_id, is_primary, status)
     VALUES ($1, $2, $3, $4, false, 'active')`,
    [booking.id, booking.property_id, member.id, primaryTenantId]
  );

  await pool.query(
    `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'stay_member_added')`,
    [
      member.id,
      'Added to a property stay',
      `You were added to "${booking.property_title || 'a property'}" by tenant ${formatDisplayId('tenant', primaryTenantId)}.`
    ]
  );

  return { success: true, member };
}

export async function removeStayMember({ booking, primaryTenantId, memberRowId }) {
  const row = await pool.query(
    `SELECT * FROM stay_members WHERE id = $1 AND booking_id = $2`,
    [memberRowId, booking.id]
  );
  if (row.rows.length === 0) return { error: 'Member not found.' };
  if (row.rows[0].is_primary) return { error: 'Cannot remove the primary tenant.' };

  await pool.query(`DELETE FROM stay_members WHERE id = $1`, [memberRowId]);
  return { success: true };
}
