/**
 * Incremental DB sync — safe to run anytime.
 * Applies schema patches, media/chat constraints, seeds missing templates & default videos.
 *
 * Usage: npm run db:sync
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL missing in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000
});

const DEFAULT_YOUTUBE_ID = process.env.DEFAULT_LISTING_YOUTUBE_ID || 'UfEiKK-iX70';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'gka.109251@gmail.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Aditya@159251';

async function applySchemaPatches(client) {
  console.log('→ Schema patches (properties, media, chat, platform)...');

  await client.query(`
    DO $$ BEGIN
      ALTER TYPE booking_status ADD VALUE 'approved';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  const paymentPurposeValues = [
    'listing_fee',
    'visibility_boost',
    'lock_request_fee',
    'roommate_unlock',
    'stay_binding'
  ];
  for (const v of paymentPurposeValues) {
    await client.query(`
      DO $$ BEGIN
        ALTER TYPE payment_purpose ADD VALUE '${v}';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  }
  console.log('  ✓ payment_purpose enum (roommate_unlock, listing_fee, …)');

  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS youtube_url text`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS availability_status text DEFAULT 'vacant'`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_premium boolean DEFAULT false`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS nearest_college text`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS display_rank int`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_platform_listing boolean DEFAULT false`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS map_address text`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS actual_price numeric`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS offer_price numeric`);
  await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS offer_reason text`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_college ON properties(nearest_college)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_rank ON properties(display_rank NULLS LAST)`);

  await client.query(`
    ALTER TABLE tenant_bookings
    ADD COLUMN IF NOT EXISTS occupants jsonb DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS aadhar_front_url text,
    ADD COLUMN IF NOT EXISTS aadhar_back_url text
  `);

  await client.query(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS aadhar_front_url text,
    ADD COLUMN IF NOT EXISTS aadhar_back_url text,
    ADD COLUMN IF NOT EXISTS admin_tier text
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_broadcasts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      title text NOT NULL,
      body text NOT NULL,
      target_roles text[] DEFAULT '{}',
      target_user_ids uuid[] DEFAULT '{}',
      sent_count int DEFAULT 0,
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW()
    )
  `);

  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_media_file_type_check') THEN
        ALTER TABLE property_media
        ADD CONSTRAINT property_media_file_type_check
        CHECK (file_type IN ('image', 'youtube'));
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL DEFAULT '{}',
      description text,
      updated_at timestamptz DEFAULT NOW()
    );
  `);

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE lock_request_status AS ENUM ('pending', 'accepted', 'rejected', 'expired');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS property_lock_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
      status text DEFAULT 'pending',
      note text,
      lock_start timestamptz,
      lock_end timestamptz,
      payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS roommate_contact_unlocks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      target_user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
      expires_at timestamptz,
      is_active boolean DEFAULT true,
      created_at timestamptz DEFAULT NOW(),
      UNIQUE(user_id, target_user_id)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS student_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      service_key text NOT NULL,
      service_label text,
      status text DEFAULT 'active',
      provider_name text,
      plan_name text,
      notes text,
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW(),
      updated_at timestamptz DEFAULT NOW(),
      UNIQUE(student_id, service_key)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS tiffin_deals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      provider_name text NOT NULL,
      plan_name text,
      deal_value numeric DEFAULT 0,
      commission_value numeric DEFAULT 0,
      status text DEFAULT 'opted_in',
      metadata jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false
  `);

  await client.query(`
    UPDATE profiles SET email_verified = true
    WHERE email_verified IS NOT TRUE
      AND (auth_provider = 'google' OR verification_status = 'verified' OR role = 'admin')
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      channel text NOT NULL,
      target text NOT NULL,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts int DEFAULT 0,
      created_at timestamptz DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS tenant_notification_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
      property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
      tenant_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      notification_type text NOT NULL,
      message text NOT NULL,
      recipient_count integer DEFAULT 1,
      metadata jsonb DEFAULT '{}',
      sent_at timestamptz DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS unlocked_at timestamptz,
    ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES tenant_bookings(id) ON DELETE SET NULL
  `);

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_property_media_property ON property_media(property_id);`,
    `CREATE INDEX IF NOT EXISTS idx_property_media_sort ON property_media(property_id, sort_order);`,
    `CREATE INDEX IF NOT EXISTS idx_property_media_type ON property_media(property_id, file_type);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_property_media_one_youtube ON property_media(property_id) WHERE file_type = 'youtube';`,
    `CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);`,
    `CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC NULLS LAST);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(conversation_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_contact_unlock_expires ON contact_unlocks(expires_at) WHERE is_active = true;`,
    `CREATE INDEX IF NOT EXISTS idx_tenant_notify_owner ON tenant_notification_log(owner_id, sent_at DESC);`
  ];

  for (const sql of indexes) {
    await client.query(sql);
  }

  const defaultSettings = [
    ['contact_unlock_standard_inr', '29', 'Contact unlock price — Standard section'],
    ['contact_unlock_premium_inr', '49', 'Contact unlock price — Premium section'],
    ['contact_unlock_days', '30', 'Days before contact auto-locks'],
    ['lock_request_hide_days', '7', 'Days property hidden after lock accepted'],
    ['visibility_boost_inr', '99', 'Paid visibility add-on'],
    ['default_listing_youtube_id', DEFAULT_YOUTUBE_ID, 'Fallback tour video when owner skips YouTube link'],
    ['chat_preset_only_enforced', 'true', 'Block free-text & contact sharing in inquiry chats'],
    ['max_listing_photos', '12', 'Max photos per property listing'],
    ['logo_url', 'https://i.postimg.cc/pV527RJK/logo.png', 'Site logo URL (super admin editable)'],
    ['favicon_url', 'https://i.postimg.cc/Nj6b1m6s/logo.png', 'Favicon URL'],
    ['site_name', 'GharKaAdda', 'Brand name'],
    ['nearby_colleges_json', JSON.stringify([
      'CGC UNIVERSITY MOHALI',
      'CHANDIGARH UNIVERSITY',
      'CGC LANDRAN',
      'QUEST GROUP OF COLLEGES',
      'CHITKARA UNIVERSITY'
    ]), 'College filter list for student search']
  ];

  for (const [key, val, desc] of defaultSettings) {
    await client.query(
      `INSERT INTO platform_settings (key, value, description)
       VALUES ($1, to_jsonb($2::text), $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, val, desc]
    );
  }
}

async function syncListingMedia(client) {
  console.log('→ Listing media (YouTube first + photos)...');

  const inserted = await client.query(`
    INSERT INTO property_media (property_id, file_url, file_type, is_cover, sort_order, metadata)
    SELECT p.id, $1, 'youtube', true, 0, '{"source":"db-sync"}'::jsonb
    FROM properties p
    WHERE NOT EXISTS (
      SELECT 1 FROM property_media pm
      WHERE pm.property_id = p.id AND pm.file_type = 'youtube'
    )
  `, [DEFAULT_YOUTUBE_ID]);

  await client.query(`
    UPDATE property_media pm
    SET sort_order = pm.sort_order + 1
    FROM properties p
    WHERE pm.property_id = p.id
      AND pm.file_type != 'youtube'
      AND EXISTS (
        SELECT 1 FROM property_media yt
        WHERE yt.property_id = p.id AND yt.file_type = 'youtube' AND yt.sort_order = 0
      )
      AND pm.sort_order < 1
  `);

  await client.query(`
    UPDATE property_media SET sort_order = 0 WHERE file_type = 'youtube'
  `);

  await client.query(`
    WITH ranked AS (
      SELECT id, property_id,
             ROW_NUMBER() OVER (PARTITION BY property_id ORDER BY sort_order, created_at) AS rn
      FROM property_media WHERE file_type = 'image'
    )
    UPDATE property_media pm
    SET sort_order = r.rn, is_cover = (r.rn = 1)
    FROM ranked r WHERE pm.id = r.id
  `);

  const stats = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM properties) AS properties,
      (SELECT COUNT(*)::int FROM property_media WHERE file_type = 'youtube') AS youtube,
      (SELECT COUNT(*)::int FROM property_media WHERE file_type = 'image') AS images
  `);
  const s = stats.rows[0];
  console.log(
    `   Properties: ${s.properties} | YouTube rows: ${s.youtube} (+${inserted.rowCount} new) | Photos: ${s.images}`
  );
}

async function seedChatTemplates(client) {
  console.log('→ Chat preset templates...');

  const templates = [
    ['tenant', 'Is this property still available?', 'Is this property still available?'],
    ['tenant', 'Can I schedule a visit?', 'Can I schedule a visit?'],
    ['tenant', 'Is food included?', 'Is food included?'],
    ['tenant', 'Is deposit negotiable?', 'Is deposit negotiable?'],
    ['tenant', 'Can I move in this week?', 'Can I move in this week?'],
    ['tenant', 'Is electricity included?', 'Is electricity included?'],
    ['tenant', 'Is WiFi included?', 'Is WiFi included?'],
    ['tenant', 'Are visitors allowed?', 'Are visitors allowed?'],
    ['owner', 'Yes, it is available.', 'Yes, it is available.'],
    ['owner', 'Please schedule a visit.', 'Please schedule a visit.'],
    ['owner', 'Food is included.', 'Food is included.'],
    ['owner', 'Deposit is fixed.', 'Deposit is fixed.'],
    ['owner', 'You can move in after verification.', 'You can move in after verification.'],
    ['owner', 'Electricity is charged separately.', 'Electricity is charged separately.'],
    ['owner', 'WiFi is included.', 'WiFi is included.'],
    ['owner', 'Visitors are allowed as per house rules.', 'Visitors are allowed as per house rules.']
  ];

  let inserted = 0;
  for (const [sender_type, label, body] of templates) {
    const exists = await client.query(
      `SELECT 1 FROM message_templates WHERE sender_type = $1 AND body = $2 LIMIT 1`,
      [sender_type, body]
    );
    if (exists.rows.length) continue;
    await client.query(
      `INSERT INTO message_templates (label, body, sender_type, is_active) VALUES ($1, $2, $3, true)`,
      [label, body, sender_type]
    );
    inserted += 1;
  }

  const count = await client.query(`SELECT COUNT(*)::int AS c FROM message_templates WHERE is_active = true`);
  console.log(`   Active templates: ${count.rows[0].c} (new: ${inserted})`);
}

async function expirePropertyLocks(client) {
  await client.query(`
    UPDATE property_lock_requests SET status = 'expired', updated_at = NOW()
    WHERE status = 'accepted' AND lock_end IS NOT NULL AND lock_end < NOW()
  `);
  await client.query(`
    UPDATE properties p SET availability_status = 'vacant', updated_at = NOW()
    WHERE availability_status = 'locked'
      AND NOT EXISTS (
        SELECT 1 FROM property_lock_requests lr
        WHERE lr.property_id = p.id AND lr.status = 'accepted'
          AND (lr.lock_end IS NULL OR lr.lock_end > NOW())
      )
  `);
}

async function syncResidentChats(client) {
  console.log('→ Resident chats (unlock when booking active)...');

  const active = await client.query(`
    SELECT tb.id AS booking_id, tb.tenant_id, tb.owner_id, tb.property_id
    FROM tenant_bookings tb
    WHERE tb.status IN ('approved', 'active', 'confirmed')
  `);

  let unlocked = 0;
  for (const b of active.rows) {
    const r = await client.query(
      `INSERT INTO conversations (tenant_id, owner_id, property_id, status, booking_id, unlocked_at, last_message)
       VALUES ($1, $2, $3, 'unlocked', $4, NOW(), 'Stay confirmed — resident chat active')
       ON CONFLICT (tenant_id, owner_id, property_id)
       DO UPDATE SET status = 'unlocked', booking_id = EXCLUDED.booking_id,
         unlocked_at = COALESCE(conversations.unlocked_at, NOW()), updated_at = NOW()
       RETURNING id`,
      [b.tenant_id, b.owner_id, b.property_id, b.booking_id]
    );
    if (r.rows.length) unlocked += 1;
  }

  console.log(`   Active stays synced: ${unlocked}`);
}

async function ensureAdminUser(client) {
  console.log('→ Admin account (hidden login)...');

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  await client.query(
    `INSERT INTO profiles (full_name, email, password_hash, role, onboarding_step, verification_status)
     VALUES ('GKA Platform Admin', $1, $2, 'admin', 'role_selected', 'verified')
     ON CONFLICT (email) DO UPDATE SET
       role = 'admin',
       password_hash = EXCLUDED.password_hash,
       verification_status = 'verified',
       onboarding_step = 'role_selected',
       updated_at = NOW()`,
    [ADMIN_EMAIL, hash]
  );
  console.log(`   Admin: ${ADMIN_EMAIL}`);
}

async function printSummary(client) {
  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM properties) AS properties,
      (SELECT COUNT(*)::int FROM property_media WHERE file_type = 'youtube') AS youtube_media,
      (SELECT COUNT(*)::int FROM property_media WHERE file_type = 'image') AS images,
      (SELECT COUNT(*)::int FROM conversations) AS conversations,
      (SELECT COUNT(*)::int FROM conversations WHERE status = 'unlocked') AS unlocked_chats,
      (SELECT COUNT(*)::int FROM conversations WHERE status = 'preset_only') AS preset_chats,
      (SELECT COUNT(*)::int FROM message_templates WHERE is_active) AS chat_templates,
      (SELECT COUNT(*)::int FROM platform_settings) AS settings
  `);
  const s = counts.rows[0];
  console.log('\n📊 Database summary');
  console.log(`   Properties: ${s.properties}`);
  console.log(`   Media — YouTube: ${s.youtube_media} | Photos: ${s.images}`);
  console.log(`   Chats — Total: ${s.conversations} | Unlocked: ${s.unlocked_chats} | Preset-only: ${s.preset_chats}`);
  console.log(`   Chat templates: ${s.chat_templates} | Platform settings: ${s.settings}`);
}

async function main() {
  console.log('⚡ GharKaAdda DB Sync starting...\n');
  const client = await pool.connect();

  try {
    await applySchemaPatches(client);
    await seedChatTemplates(client);
    await syncListingMedia(client);
    await expirePropertyLocks(client);
    await syncResidentChats(client);
    await ensureAdminUser(client);
    await printSummary(client);
    console.log('\n✅ DB sync complete.');
  } catch (err) {
    console.error('❌ DB sync failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
