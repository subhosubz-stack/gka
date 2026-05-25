import pool from '../db.js';

export async function getSuperAdminAnalytics() {
  const [
    totals,
    signupsByDay,
    usersByRole,
    propertiesByStatus,
    wishlistTop,
    paymentsByStatus,
    paymentsByDay,
    activityBreakdown,
    recentUsers,
    recentPayments
  ] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM profiles WHERE role != 'admin') AS total_users,
        (SELECT COUNT(*)::int FROM profiles WHERE role = 'tenant') AS students,
        (SELECT COUNT(*)::int FROM profiles WHERE role = 'owner') AS owners,
        (SELECT COUNT(*)::int FROM profiles WHERE role = 'broker') AS brokers,
        (SELECT COUNT(*)::int FROM properties) AS total_properties,
        (SELECT COUNT(*)::int FROM properties WHERE status = 'approved') AS live_properties,
        (SELECT COUNT(*)::int FROM properties WHERE status = 'pending') AS pending_properties,
        (SELECT COUNT(*)::int FROM property_favorites) AS wishlist_total,
        (SELECT COUNT(*)::int FROM payments) AS payments_total,
        (SELECT COALESCE(SUM(amount),0)::numeric FROM payments WHERE status = 'paid') AS revenue_paid,
        (SELECT COUNT(*)::int FROM conversation_messages) AS messages_total,
        (SELECT COUNT(*)::int FROM tenant_bookings) AS bookings_total,
        (SELECT COUNT(*)::int FROM property_lock_requests) AS lock_requests_total
    `),
    pool.query(`
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM profiles
      WHERE role != 'admin' AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `),
    pool.query(`
      SELECT role, COUNT(*)::int AS count
      FROM profiles WHERE role != 'admin'
      GROUP BY role ORDER BY count DESC
    `),
    pool.query(`
      SELECT status, COUNT(*)::int AS count FROM properties GROUP BY status ORDER BY count DESC
    `),
    pool.query(`
      SELECT p.id, p.title, p.city, p.nearest_college, p.status,
             COUNT(pf.id)::int AS wishlist_count
      FROM properties p
      LEFT JOIN property_favorites pf ON pf.property_id = p.id
      GROUP BY p.id
      ORDER BY wishlist_count DESC, p.created_at DESC
      LIMIT 25
    `),
    pool.query(`
      SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount_sum
      FROM payments GROUP BY status ORDER BY count DESC
    `),
    pool.query(`
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric AS paid_amount
      FROM payments
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `),
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM property_favorites WHERE created_at >= NOW() - INTERVAL '7 days') AS wishlists_7d,
        (SELECT COUNT(*)::int FROM payments WHERE created_at >= NOW() - INTERVAL '7 days') AS payments_7d,
        (SELECT COUNT(*)::int FROM conversation_messages WHERE created_at >= NOW() - INTERVAL '7 days') AS messages_7d,
        (SELECT COUNT(*)::int FROM profiles WHERE created_at >= NOW() - INTERVAL '7 days' AND role != 'admin') AS signups_7d,
        (SELECT COUNT(*)::int FROM property_lock_requests WHERE created_at >= NOW() - INTERVAL '7 days') AS locks_7d
    `),
    pool.query(`
      SELECT id, full_name, email, role, created_at
      FROM profiles WHERE role != 'admin'
      ORDER BY created_at DESC LIMIT 15
    `),
    pool.query(`
      SELECT pay.id, pay.amount, pay.status, pay.purpose, pay.created_at,
             u.full_name AS user_name, u.email AS user_email,
             p.title AS property_title
      FROM payments pay
      LEFT JOIN profiles u ON pay.user_id = u.id
      LEFT JOIN properties p ON pay.property_id = p.id
      ORDER BY pay.created_at DESC LIMIT 15
    `)
  ]);

  return {
    totals: totals.rows[0],
    signups_by_day: signupsByDay.rows,
    users_by_role: usersByRole.rows,
    properties_by_status: propertiesByStatus.rows,
    wishlist_top_properties: wishlistTop.rows,
    payments_by_status: paymentsByStatus.rows,
    payments_by_day: paymentsByDay.rows,
    activity_7d: activityBreakdown.rows[0],
    recent_users: recentUsers.rows,
    recent_payments: recentPayments.rows
  };
}

export function parseMeta(row) {
  if (!row?.metadata) return {};
  if (typeof row.metadata === 'object') return row.metadata;
  try {
    return JSON.parse(row.metadata);
  } catch {
    return {};
  }
}

export function isUserBanned(user) {
  const m = parseMeta(user);
  return m.banned === true || m.account_banned === true;
}
