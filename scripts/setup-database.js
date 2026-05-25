import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

// Force load .env from the root
dotenv.config({ path: path.join(process.cwd(), '.env') });

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('⚠️ WARNING: DATABASE_URL environment variable is not defined. Skipping database setup tables creation.');
  process.exit(0);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runSetup() {
  console.log('⚡ Starting GharKaAdda Database Setup...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('Connected to NeonDB PostgreSQL! Initializing transaction...');

    // 1. Enable Extensions
    console.log('1. Configuring extensions...');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    // 2. Create Enums Safely using custom lookup blocks
    console.log('2. Registering PostgreSQL enums safely...');

    const enums = [
      {
        name: 'user_role',
        values: ["'tenant'", "'owner'", "'broker'", "'admin'"]
      },
      {
        name: 'verification_status',
        values: ["'basic_pending'", "'pending'", "'verified'", "'rejected'", "'suspended'", "'admin_verification_required'"]
      },
      {
        name: 'property_type',
        values: ["'pg'", "'room'", "'flat'", "'hostel'", "'studio'", "'independent_house'"]
      },
      {
        name: 'listing_type',
        values: ["'regular'", "'premium'", "'no_brokerage'", "'broker_tie_up'"]
      },
      {
        name: 'property_status',
        values: ["'draft'", "'pending'", "'approved'", "'rejected'", "'archived'"]
      },
      {
        name: 'booking_status',
        values: ["'pending'", "'approved'", "'confirmed'", "'active'", "'completed'", "'cancelled'", "'rejected'"]
      },
      {
        name: 'conversation_status',
        values: ["'preset_only'", "'unlocked'", "'closed'"]
      },
      {
        name: 'payment_status',
        values: ["'created'", "'pending'", "'paid'", "'failed'", "'refunded'", "'cancelled'"]
      },
      {
        name: 'payment_purpose',
        values: [
          "'contact_unlock'",
          "'booking_fee'",
          "'rent'",
          "'premium_listing'",
          "'owner_subscription'",
          "'broker_plan'",
          "'lead_fee'",
          "'listing_fee'",
          "'visibility_boost'",
          "'lock_request_fee'",
          "'roommate_unlock'",
          "'stay_binding'",
          "'other'"
        ]
      },
      {
        name: 'visit_status',
        values: ["'requested'", "'approved'", "'rejected'", "'completed'", "'cancelled'"]
      },
      {
        name: 'report_status',
        values: ["'open'", "'reviewing'", "'resolved'", "'dismissed'"]
      },
      {
        name: 'maintenance_status',
        values: ["'open'", "'in_progress'", "'resolved'", "'rejected'"]
      }
    ];

    for (const en of enums) {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${en.name}') THEN
            CREATE TYPE ${en.name} AS ENUM (${en.values.join(', ')});
          END IF;
        END $$;
      `);
    }

    await client.query(`
      DO $$ BEGIN
        ALTER TYPE booking_status ADD VALUE 'approved';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    const paymentPurposeExtras = [
      'listing_fee',
      'visibility_boost',
      'lock_request_fee',
      'roommate_unlock',
      'stay_binding'
    ];
    for (const v of paymentPurposeExtras) {
      await client.query(`
        DO $$ BEGIN
          ALTER TYPE payment_purpose ADD VALUE '${v}';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    }

    // 3. Create Trigger Function for updated_at
    console.log('3. Registering auto-update trigger functions...');
    await client.query(`
      CREATE OR REPLACE FUNCTION trigger_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 4. Create Tables
    console.log('4. Building tables and structures...');

    // -- profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_user_id text UNIQUE,
        auth_provider text DEFAULT 'local',
        full_name text NOT NULL,
        email text UNIQUE NOT NULL,
        phone text,
        password_hash text,
        role user_role NOT NULL DEFAULT 'tenant',
        avatar_url text,
        city text,
        verification_status verification_status DEFAULT 'basic_pending',
        onboarding_step text DEFAULT 'account_created',
        metadata jsonb DEFAULT '{}',
        email_verified boolean DEFAULT false,
        phone_verified boolean DEFAULT false,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
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
      );
    `);

    // -- properties
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        broker_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
        title text NOT NULL,
        description text,
        property_type property_type NOT NULL DEFAULT 'pg',
        listing_type listing_type NOT NULL DEFAULT 'regular',
        status property_status NOT NULL DEFAULT 'pending',
        verified boolean DEFAULT false,
        address_line text,
        locality text,
        city text,
        state text,
        pincode text,
        latitude numeric,
        longitude numeric,
        monthly_rent numeric NOT NULL DEFAULT 0 CHECK (monthly_rent >= 0),
        security_deposit numeric NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
        maintenance_fee numeric NOT NULL DEFAULT 0 CHECK (maintenance_fee >= 0),
        brokerage_fee numeric NOT NULL DEFAULT 0 CHECK (brokerage_fee >= 0),
        capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),
        available_beds integer NOT NULL DEFAULT 1 CHECK (available_beds >= 0),
        gender_preference text DEFAULT 'any',
        available_from date,
        amenities jsonb DEFAULT '[]',
        rules jsonb DEFAULT '{}',
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        youtube_url text
      );
    `);

    await client.query(`ALTER TABLE properties ADD COLUMN IF NOT EXISTS youtube_url text`);

    // -- property_media (youtube tour video sort_order=0, images sort_order>=1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS property_media (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        file_url text NOT NULL,
        file_type text DEFAULT 'image',
        is_cover boolean DEFAULT false,
        sort_order integer DEFAULT 0,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW()
      );
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

    // -- platform_settings (admin: unlock prices, chat rules, default video id)
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL DEFAULT '{}',
        description text,
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- tenant_notification_log (rent reminders / owner notices audit)
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

    // -- roommate_preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS roommate_preferences (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
        budget_min numeric DEFAULT 0,
        budget_max numeric DEFAULT 0,
        preferred_city text,
        preferred_localities jsonb DEFAULT '[]',
        gender_preference text,
        food_preference text,
        smoking_preference text,
        drinking_preference text,
        sleep_schedule text,
        cleanliness_level text,
        study_preference text,
        guest_preference text,
        pets_preference text,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- property_favorites
    await client.query(`
      CREATE TABLE IF NOT EXISTS property_favorites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        created_at timestamptz DEFAULT NOW(),
        UNIQUE(user_id, property_id)
      );
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
        payment_id uuid,
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
        payment_id uuid,
        expires_at timestamptz,
        is_active boolean DEFAULT true,
        created_at timestamptz DEFAULT NOW(),
        UNIQUE(user_id, target_user_id)
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

    // -- contact_unlocks
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_unlocks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        payment_id uuid, -- Linked later when payment table is built
        starts_at timestamptz DEFAULT NOW(),
        expires_at timestamptz,
        is_active boolean DEFAULT true,
        created_at timestamptz DEFAULT NOW(),
        UNIQUE(user_id, property_id)
      );
    `);

    // -- tenant_bookings
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_bookings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        status booking_status DEFAULT 'pending',
        monthly_rent numeric DEFAULT 0,
        security_deposit numeric DEFAULT 0,
        booking_amount numeric DEFAULT 0,
        move_in_date date,
        active_from timestamptz,
        active_until timestamptz,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- property_visit_requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS property_visit_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        visit_date date,
        visit_slot text,
        status visit_status DEFAULT 'requested',
        note text,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- conversations (preset_only before rent; unlocked after active booking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        broker_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        booking_id uuid REFERENCES tenant_bookings(id) ON DELETE SET NULL,
        status conversation_status DEFAULT 'preset_only',
        unlocked_at timestamptz,
        last_message text,
        last_message_at timestamptz,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        UNIQUE(tenant_id, owner_id, property_id)
      );
    `);

    await client.query(`
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES tenant_bookings(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS unlocked_at timestamptz
    `);

    // -- conversation_messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        sender_type text,
        body text NOT NULL,
        is_template boolean DEFAULT false,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW()
      );
    `);

    // -- message_templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        label text,
        body text,
        sender_type text,
        is_active boolean DEFAULT true,
        created_at timestamptz DEFAULT NOW()
      );
    `);

    // -- payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
        booking_id uuid REFERENCES tenant_bookings(id) ON DELETE SET NULL,
        amount numeric NOT NULL,
        platform_fee numeric DEFAULT 0,
        currency text DEFAULT 'INR',
        purpose payment_purpose DEFAULT 'other',
        status payment_status DEFAULT 'created',
        provider text DEFAULT 'razorpay',
        provider_order_id text,
        provider_payment_id text,
        provider_signature text,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        title text NOT NULL,
        body text,
        type text,
        is_read boolean DEFAULT false,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW()
      );
    `);

    // -- reports
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        reported_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
        property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
        conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        reason text,
        status report_status DEFAULT 'open',
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- maintenance_requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        owner_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        booking_id uuid REFERENCES tenant_bookings(id) ON DELETE SET NULL,
        title text NOT NULL,
        description text,
        status maintenance_status DEFAULT 'open',
        priority text DEFAULT 'normal',
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- platform_plans
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        role_target user_role,
        price numeric DEFAULT 0,
        duration_days integer DEFAULT 30,
        features jsonb DEFAULT '[]',
        is_active boolean DEFAULT true,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW()
      );
    `);

    // -- subscriptions
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        plan_id uuid REFERENCES platform_plans(id) ON DELETE RESTRICT,
        status text DEFAULT 'active',
        starts_at timestamptz DEFAULT NOW(),
        ends_at timestamptz,
        payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW()
      );
    `);

    // -- property_boosts
    await client.query(`
      CREATE TABLE IF NOT EXISTS property_boosts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
        payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
        boost_type text DEFAULT 'premium',
        starts_at timestamptz DEFAULT NOW(),
        ends_at timestamptz,
        is_active boolean DEFAULT true,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT NOW()
      );
    `);

    // 5. Apply triggers to tables with updated_at columns
    console.log('5. Applying update timestamps triggers to tables...');
    const tablesWithTrigger = [
      'profiles', 'properties', 'roommate_preferences', 'tenant_bookings',
      'property_visit_requests', 'conversations', 'payments', 'reports',
      'maintenance_requests', 'subscriptions'
    ];

    for (const t of tablesWithTrigger) {
      await client.query(`
        DROP TRIGGER IF EXISTS set_timestamp_on_${t} ON ${t};
        CREATE TRIGGER set_timestamp_on_${t}
        BEFORE UPDATE ON ${t}
        FOR EACH ROW
        EXECUTE PROCEDURE trigger_set_timestamp();
      `);
    }

    // 6. Create Indexes
    console.log('6. Generating optimized database indexes...');
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);',
      'CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);',
      'CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON properties(owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_properties_broker_id ON properties(broker_id);',
      'CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);',
      'CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);',
      'CREATE INDEX IF NOT EXISTS idx_properties_locality ON properties(locality);',
      'CREATE INDEX IF NOT EXISTS idx_properties_rent ON properties(monthly_rent);',
      'CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(property_type);',
      'CREATE INDEX IF NOT EXISTS idx_properties_listing_type ON properties(listing_type);',
      'CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON tenant_bookings(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_bookings_owner_id ON tenant_bookings(owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_bookings_property_id ON tenant_bookings(property_id);',
      'CREATE INDEX IF NOT EXISTS idx_bookings_status ON tenant_bookings(status);',
      'CREATE INDEX IF NOT EXISTS idx_visit_tenant_id ON property_visit_requests(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_visit_owner_id ON property_visit_requests(owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_visit_property_id ON property_visit_requests(property_id);',
      'CREATE INDEX IF NOT EXISTS idx_conv_tenant_id ON conversations(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_conv_owner_id ON conversations(owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_conv_property_id ON conversations(property_id);',
      'CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);',
      'CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC NULLS LAST);',
      'CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON conversation_messages(conversation_id);',
      'CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(conversation_id, created_at);',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_message_templates_unique ON message_templates(sender_type, body);',
      'CREATE INDEX IF NOT EXISTS idx_property_media_property ON property_media(property_id);',
      'CREATE INDEX IF NOT EXISTS idx_property_media_sort ON property_media(property_id, sort_order);',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_property_media_one_youtube ON property_media(property_id) WHERE file_type = \'youtube\';',
      'CREATE INDEX IF NOT EXISTS idx_contact_unlock_expires ON contact_unlocks(expires_at) WHERE is_active = true;',
      'CREATE INDEX IF NOT EXISTS idx_tenant_notify_owner ON tenant_notification_log(owner_id, sent_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_payments_property_id ON payments(property_id);',
      'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_maintenance_tenant_id ON maintenance_requests(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_maintenance_owner_id ON maintenance_requests(owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);'
    ];

    for (const idx of indexes) {
      await client.query(idx);
    }

    // 7. Seeding Data
    console.log('7. Seeding realistic dataset and test users...');

    // Hash Password for demo users
    const defaultHash = bcrypt.hashSync('Password@123', 10);

    // Seeding Platform Plans
    const plansResult = await client.query(`
      INSERT INTO platform_plans (name, role_target, price, duration_days, features)
      VALUES 
        ('Premium Owner Plan', 'owner', 999, 30, '["List unlimited properties", "Top spot in search recommendations", "Visual rich analytics dashboard", "Whatsapp alert integration"]'),
        ('Featured Broker Plan', 'broker', 1999, 30, '["Featured broker tag", "High priority lead notifications", "Verified connection requests"]'),
        ('Standard Contact Pack', 'tenant', 0, 30, '["Base listings discovery", "Normal visit requests", "Roommate search questionnaire"]')
      ON CONFLICT DO NOTHING
      RETURNING id, name;
    `);

    // Safe Seeding Users (Profiles)
    console.log(' - Seeding tenant, owner, broker, and admin profiles...');
    const users = [
      { email: 'tenant.search@gka.demo', full_name: 'Rahul Sharma', phone: '+919876543210', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant.active@gka.demo', full_name: 'Priyanka Sen', phone: '+919911223344', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant3@gka.demo', full_name: 'Amit Patel', phone: '+919100223344', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant4@gka.demo', full_name: 'Siddharth Roy', phone: '+919444332211', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant5@gka.demo', full_name: 'Meera Nair', phone: '+919555667788', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant6@gka.demo', full_name: 'Vikram Joshi', phone: '+919666778899', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant7@gka.demo', full_name: 'Ananya Goel', phone: '+919777889900', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant8@gka.demo', full_name: 'Karan Malhotra', phone: '+919888990011', role: 'tenant', status: 'verified', onboarding: 'role_selected' },
      { email: 'tenant9@gka.demo', full_name: 'Divya Aggarwal', phone: '+919999001122', role: 'tenant', status: 'basic_pending', onboarding: 'account_created' },
      { email: 'tenant10@gka.demo', full_name: 'Pranav Sood', phone: '+919111223344', role: 'tenant', status: 'basic_pending', onboarding: 'account_created' },
      
      { email: 'owner1@gka.demo', full_name: 'Harminder Singh', phone: '+918882223311', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner2@gka.demo', full_name: 'Sanjeev Bansal', phone: '+918112233445', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner3@gka.demo', full_name: 'Mrs. Sharda Devi', phone: '+917711223344', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner4@gka.demo', full_name: 'Satnam Preet', phone: '+919011225544', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner5@gka.demo', full_name: 'Rajinder Kumar', phone: '+919311224455', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner6@gka.demo', full_name: 'Asha Gupta', phone: '+919411224466', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner7@gka.demo', full_name: 'Yogesh Juneja', phone: '+919511224477', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner8@gka.demo', full_name: 'Harcharan Singh', phone: '+919611224488', role: 'owner', status: 'verified', onboarding: 'role_selected' },
      { email: 'owner9@gka.demo', full_name: 'Bimal Kanti', phone: '+919711224499', role: 'owner', status: 'basic_pending', onboarding: 'account_created' },
      { email: 'owner10@gka.demo', full_name: 'Gurmeet Dhillon', phone: '+919811224400', role: 'owner', status: 'basic_pending', onboarding: 'account_created' },

      { email: 'broker1@gka.demo', full_name: 'Chandigarh Best Brokers', phone: '+919223344556', role: 'broker', status: 'verified', onboarding: 'role_selected', metadata: { broker_type: 'lease_broker' } },
      { email: 'broker2@gka.demo', full_name: 'A-One Student Housing Dealers', phone: '+917223344556', role: 'broker', status: 'verified', onboarding: 'role_selected', metadata: { broker_type: 'broker_50' } },
      { email: 'broker3@gka.demo', full_name: 'Paras Real Estate', phone: '+918223344556', role: 'broker', status: 'verified', onboarding: 'role_selected', metadata: { broker_type: 'service_partner' } },
      { email: 'broker4@gka.demo', full_name: 'Tricity Rentals Ltd', phone: '+916223344556', role: 'broker', status: 'verified', onboarding: 'role_selected', metadata: { broker_type: 'lease_broker' } },
      { email: 'broker5@gka.demo', full_name: 'Mohali Prime Estates', phone: '+915223344556', role: 'broker', status: 'basic_pending', onboarding: 'account_created', metadata: { broker_type: 'broker_50' } },

      { email: 'admin@gka.demo', full_name: 'Supreme Admin', phone: '+919999999999', role: 'admin', status: 'verified', onboarding: 'role_selected' }
    ];

    const profilesMap = {};
    for (const u of users) {
      const res = await client.query(`
        INSERT INTO profiles (full_name, email, phone, password_hash, role, verification_status, onboarding_step, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (email) DO UPDATE 
        SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, role = EXCLUDED.role, verification_status = EXCLUDED.verification_status
        RETURNING id, role, email;
      `, [u.full_name, u.email, u.phone, defaultHash, u.role, u.status, u.onboarding, JSON.stringify(u.metadata || {})]);
      
      const seededUser = res.rows[0];
      profilesMap[u.email] = seededUser.id;
    }

    // Seeding Properties
    console.log(' - Seeding approved and pending properties...');
    const propertiesData = [
      {
        owner_email: 'owner1@gka.demo',
        title: 'Premium Single occupancy AC Room in Chandigarh Sector 15',
        description: 'Excellent spacious room for students/working professionals. Very close to Sector 15 market and PU. Includes high-speed water geyser, Wi-Fi, and neat attached washroom.',
        property_type: 'room',
        listing_type: 'premium',
        status: 'approved',
        verified: true,
        address_line: 'House No. 3204, Sector 15-D',
        locality: 'Sector 15',
        city: 'Chandigarh',
        state: 'Punjab',
        pincode: '160015',
        monthly_rent: 9500,
        security_deposit: 8000,
        maintenance_fee: 500,
        brokerage_fee: 0,
        capacity: 2,
        available_beds: 1,
        gender_preference: 'boys',
        available_from: '2026-06-01',
        amenities: ['WiFi', 'AC', 'Geyser', 'CCTV', 'Fridge', 'Washing Machine', 'Meals'],
        rules: { smoking: 'no', pets: 'no', drinking: 'no' }
      },
      {
        owner_email: 'owner1@gka.demo',
        title: 'Budget Independent Sharing PG in Sector 119 Mohali',
        description: 'Shared 2-sharing rooms for students. Clean beds, cupboards, home-cooked food options, Wi-Fi 24x7. Managed beautifully by owner living downstairs.',
        property_type: 'pg',
        listing_type: 'no_brokerage',
        status: 'approved',
        verified: true,
        address_line: 'Anand Niwas, Plot 428, Sector 119',
        locality: 'Sector 119',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140301',
        monthly_rent: 5500,
        security_deposit: 4000,
        maintenance_fee: 200,
        brokerage_fee: 0,
        capacity: 6,
        available_beds: 3,
        gender_preference: 'girls',
        available_from: '2026-05-25',
        amenities: ['WiFi', 'Geyser', 'House Keeping', 'Parking', 'Meals', 'Fridge'],
        rules: { smoking: 'no', pets: 'no', curfew: '10:00 PM' }
      },
      {
        owner_email: 'owner2@gka.demo',
        title: 'Luxury 2 BHK Serviced Flat in Sector 70 Mohali',
        description: 'Brand new luxury flat for sharing. Modern setup with premium fully loaded modular kitchen, split AC, smart LED TV, secure electronic entrance locks, and parking slot.',
        property_type: 'flat',
        listing_type: 'premium',
        status: 'approved',
        verified: true,
        address_line: 'Top Floor, Ivory Apartments, Sector 70',
        locality: 'Sector 70',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '160059',
        monthly_rent: 22000,
        security_deposit: 30000,
        maintenance_fee: 1500,
        brokerage_fee: 0,
        capacity: 4,
        available_beds: 4,
        gender_preference: 'any',
        available_from: '2026-06-15',
        amenities: ['WiFi', 'AC', 'Geyser', 'Kitchen', 'Laundry', 'CCTV', 'Balcony', 'Parking', 'Washing Machine'],
        rules: { smoking: 'allowed on balcony', guestAccess: 'parents only' }
      },
      {
        owner_email: 'owner3@gka.demo',
        title: 'Cozy PG near CGC Landran University',
        description: 'Super convenient PG for CGC students. Walkable distance to university main gate. Clean dining area, sports lounge, water cooler, security guard.',
        property_type: 'hostel',
        listing_type: 'regular',
        status: 'approved',
        verified: true,
        address_line: 'CGC Student Nest, Main Road Landran',
        locality: 'Landran',
        city: 'Landran',
        state: 'Punjab',
        pincode: '140307',
        monthly_rent: 6500,
        security_deposit: 5000,
        maintenance_fee: 300,
        brokerage_fee: 0,
        capacity: 10,
        available_beds: 8,
        gender_preference: 'boys',
        available_from: '2026-05-20',
        amenities: ['WiFi', 'Geyser', 'CCTV', 'Meals', 'Fridge', 'Parking'],
        rules: { smoking: 'no', guestCurfew: '9 PM' }
      },
      {
        owner_email: 'owner4@gka.demo',
        title: 'Elegant Girls PG near Sector 15 PU Chandigarh',
        description: 'Highly secure environment with female warden. Modern washrooms, AC lounges, proper reading desks, and high-speed multi-fiber Wi-Fi network.',
        property_type: 'pg',
        listing_type: 'regular',
        status: 'approved',
        verified: true,
        address_line: 'SCF 32, Sector 15 Market Backside',
        locality: 'Sector 15',
        city: 'Chandigarh',
        state: 'Punjab',
        pincode: '160015',
        monthly_rent: 8500,
        security_deposit: 8500,
        maintenance_fee: 300,
        brokerage_fee: 0,
        capacity: 4,
        available_beds: 2,
        gender_preference: 'girls',
        available_from: '2026-06-01',
        amenities: ['WiFi', 'AC', 'Geyser', 'CCTV', 'Balcony', 'Meals', 'Washing Machine'],
        rules: { smoking: 'no', drinking: 'no', gateCloseTime: '9:30 PM' }
      },
      {
        owner_email: 'owner5@gka.demo',
        title: 'Single Room Studio Flat in Kharar',
        description: 'Fully independent studio flat with attached private washroom and small pantry. Clean space with dynamic natural light, wardrobe, study table.',
        property_type: 'studio',
        listing_type: 'no_brokerage',
        status: 'approved',
        verified: true,
        address_line: 'B7, Shivalik City, Kharar',
        locality: 'Kharar',
        city: 'Kharar',
        state: 'Punjab',
        pincode: '140301',
        monthly_rent: 7500,
        security_deposit: 7500,
        maintenance_fee: 400,
        brokerage_fee: 0,
        capacity: 1,
        available_beds: 1,
        gender_preference: 'any',
        available_from: '2026-06-05',
        amenities: ['WiFi', 'AC', 'Geyser', 'Kitchen', 'Laundry', 'Parking'],
        rules: { familyFriendly: 'yes' }
      },
      {
        owner_email: 'owner6@gka.demo',
        title: 'Comfortable Shared Room Bair Majra Near CGC',
        description: 'Premium student beds. Food consists of delicious traditional breakfast, lunch, tea, dinner. High hygiene standards. Big common hall with Carrom board and TV.',
        property_type: 'room',
        listing_type: 'regular',
        status: 'approved',
        verified: true,
        address_line: 'Gali 2, Bair Majra village',
        locality: 'Bair Majra',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140307',
        monthly_rent: 4200,
        security_deposit: 3000,
        maintenance_fee: 100,
        brokerage_fee: 0,
        capacity: 8,
        available_beds: 5,
        gender_preference: 'boys',
        available_from: '2026-05-22',
        amenities: ['WiFi', 'CCTV', 'Parking', 'Meals', 'Fridge'],
        rules: { noiseLimit: '10:30 PM' }
      },
      {
        owner_email: 'owner7@gka.demo',
        title: 'Spacious Independent House in Mohali Sector 70',
        description: 'Spacious First floor. 3 BHK with 3 washrooms and 2 balconies. Big terrace view. Includes modular wooden kitchen, wardrobe in all rooms, water pump.',
        property_type: 'independent_house',
        listing_type: 'premium',
        status: 'approved',
        verified: true,
        address_line: 'House 438, Sector 70 residential',
        locality: 'Sector 70',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '160059',
        monthly_rent: 24000,
        security_deposit: 24000,
        maintenance_fee: 800,
        brokerage_fee: 0,
        capacity: 6,
        available_beds: 6,
        gender_preference: 'any',
        available_from: '2026-06-20',
        amenities: ['WiFi', 'AC', 'Geyser', 'Kitchen', 'CCTV', 'Balcony', 'Parking', 'Washing Machine'],
        rules: {}
      },
      {
        owner_email: 'owner1@gka.demo',
        title: 'Standard Twin Occupancy room in Sector 15 Chandigarh',
        description: '2 sharing room for college pupils. Clean beds, shared toilet, direct water purifier support, peaceful community vibes.',
        property_type: 'room',
        listing_type: 'regular',
        status: 'approved',
        verified: false,
        address_line: 'House 3122-A, Sector 15-C',
        locality: 'Sector 15',
        city: 'Chandigarh',
        state: 'Punjab',
        pincode: '160015',
        monthly_rent: 4800,
        security_deposit: 3000,
        maintenance_fee: 200,
        brokerage_fee: 0,
        capacity: 2,
        available_beds: 2,
        gender_preference: 'boys',
        available_from: '2026-06-01',
        amenities: ['WiFi', 'Geyser', 'CCTV', 'Meals'],
        rules: {}
      },
      {
        owner_email: 'owner2@gka.demo',
        title: 'Modern Single Unit Flat in Sector 119 Mohali',
        description: '1 BHK flat complete set. Fully airy, ventilation on both sides. Ideal for students who desire isolation and neat private structure.',
        property_type: 'flat',
        listing_type: 'no_brokerage',
        status: 'approved',
        verified: false,
        address_line: 'Imperial Height Block C, Sector 119',
        locality: 'Sector 119',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140301',
        monthly_rent: 11000,
        security_deposit: 11000,
        maintenance_fee: 800,
        brokerage_fee: 0,
        capacity: 2,
        available_beds: 2,
        gender_preference: 'any',
        available_from: '2026-06-01',
        amenities: ['WiFi', 'AC', 'Geyser', 'Kitchen', 'CCTV', 'Balcony', 'Parking'],
        rules: {}
      },
      {
        broker_email: 'broker1@gka.demo',
        owner_email: 'owner3@gka.demo',
        title: 'Student Deluxe PG via Verified Broker near Landran',
        description: 'Exclusive partnership with Tricity rentals. Premium bedding, gym facility downstairs, delicious menus twice day, CCTV security. Smooth broker tie-up structure.',
        property_type: 'pg',
        listing_type: 'broker_tie_up',
        status: 'approved',
        verified: true,
        address_line: 'A-22, Sector road, Landran Mohali',
        locality: 'Landran',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140307',
        monthly_rent: 7800,
        security_deposit: 8000,
        maintenance_fee: 600,
        brokerage_fee: 3000,
        capacity: 30,
        available_beds: 14,
        gender_preference: 'girls',
        available_from: '2026-06-01',
        amenities: ['WiFi', 'AC', 'Geyser', 'CCTV', 'Meals', 'Fridge', 'Washing Machine'],
        rules: {}
      },
      {
        broker_email: 'broker2@gka.demo',
        owner_email: 'owner4@gka.demo',
        title: 'Twin sharing Sector 119 flat - managed by Broker',
        description: 'Highly recommended for students of nearby campuses. High efficiency broker assistance and smooth leasing contract paper process.',
        property_type: 'flat',
        listing_type: 'broker_tie_up',
        status: 'approved',
        verified: true,
        address_line: 'Plot 311, Sector 119 Mohali',
        locality: 'Sector 119',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140301',
        monthly_rent: 9000,
        security_deposit: 9000,
        maintenance_fee: 500,
        brokerage_fee: 4500,
        capacity: 4,
        available_beds: 2,
        gender_preference: 'any',
        available_from: '2026-06-10',
        amenities: ['WiFi', 'AC', 'Geyser', 'Kitchen', 'Laundry', 'CCTV'],
        rules: {}
      },
      {
        owner_email: 'owner5@gka.demo',
        title: 'Verdant Farmhouse Studio PG in Landran',
        description: 'Amazing lush surrounding gardens. Refreshing climate and beautiful views. Daily maid service and high security limits.',
        property_type: 'studio',
        listing_type: 'regular',
        status: 'approved',
        verified: false,
        address_line: 'Landran Village road, farm block',
        locality: 'Landran',
        city: 'Landran',
        state: 'Punjab',
        pincode: '140307',
        monthly_rent: 5200,
        security_deposit: 3000,
        maintenance_fee: 100,
        brokerage_fee: 0,
        capacity: 2,
        available_beds: 2,
        gender_preference: 'boys',
        available_from: '2026-05-28',
        amenities: ['WiFi', 'Geyser', 'Parking', 'Fridge'],
        rules: {}
      },
      {
        owner_email: 'owner6@gka.demo',
        title: 'Premium Room in Sector 70 - Near PU Transit Bus',
        description: 'Perfect for transit. Bus stops directly outside the gate. Sector 70 primary market is 2 minutes walk. Fresh drinking RO water.',
        property_type: 'room',
        listing_type: 'premium',
        status: 'approved',
        verified: true,
        address_line: 'Duplex 81, Sector 70 Residential',
        locality: 'Sector 70',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '160059',
        monthly_rent: 10500,
        security_deposit: 10000,
        maintenance_fee: 400,
        brokerage_fee: 0,
        capacity: 2,
        available_beds: 1,
        gender_preference: 'any',
        available_from: '2026-06-01',
        amenities: ['WiFi', 'AC', 'Geyser', 'CCTV', 'Balcony', 'Parking', 'Fridge', 'Meals'],
        rules: {}
      },
      {
        owner_email: 'owner7@gka.demo',
        title: 'Modern Hostel Room near Chandigarh CGC Campus',
        description: 'Warden managed structure for junior scholars. Large study library with plenty of electrical outlets. 100% focus on academics.',
        property_type: 'hostel',
        listing_type: 'regular',
        status: 'approved',
        verified: true,
        address_line: 'Student Complex, Block F, Kharar State Highway',
        locality: 'Kharar',
        city: 'Kharar',
        state: 'Punjab',
        pincode: '140301',
        monthly_rent: 6200,
        security_deposit: 5000,
        maintenance_fee: 200,
        brokerage_fee: 0,
        capacity: 40,
        available_beds: 18,
        gender_preference: 'girls',
        available_from: '2026-05-30',
        amenities: ['WiFi', 'Geyser', 'CCTV', 'Meals', 'Washing Machine'],
        rules: {}
      },

      // PENDING PROPERTIES
      {
        owner_email: 'owner8@gka.demo',
        title: '[PENDING] Affordable PG for Boys near Sector 15 Chandigarh',
        description: 'A great affordable option. Seeking quick administration review. Clean bed side space, spacious cupboards, nice food, close PU gate.',
        property_type: 'pg',
        listing_type: 'regular',
        status: 'pending',
        verified: false,
        address_line: 'House 5002, Sector 15-A',
        locality: 'Sector 15',
        city: 'Chandigarh',
        state: 'Punjab',
        pincode: '160015',
        monthly_rent: 5000,
        security_deposit: 3000,
        capacity: 4,
        available_beds: 4
      },
      {
        owner_email: 'owner8@gka.demo',
        title: '[PENDING] Triple Sharing Modern flat in Bair Majra',
        description: 'New construction needing verification. Fully modern and secure, separate kitchen setups, high pressure water.',
        property_type: 'flat',
        listing_type: 'no_brokerage',
        status: 'pending',
        verified: false,
        address_line: 'Block 2, New Town Homes, Bair Majra',
        locality: 'Bair Majra',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140307',
        monthly_rent: 8000,
        security_deposit: 8000,
        capacity: 3,
        available_beds: 3
      },
      {
        owner_email: 'owner9@gka.demo',
        title: '[PENDING] Sector 70 Clean Study Room for Girls',
        description: 'Waiting for admin approval, listing details include WiFi, daily sweeping.',
        property_type: 'room',
        listing_type: 'regular',
        status: 'pending',
        verified: false,
        address_line: 'C-414, Sector 70',
        locality: 'Sector 70',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '160059',
        monthly_rent: 6000,
        security_deposit: 5000,
        capacity: 2,
        available_beds: 2
      },
      {
        owner_email: 'owner10@gka.demo',
        title: '[PENDING] Shared Hostel Room in Kharar Sector 119',
        description: 'Nice hostel property for college students, pending verification.',
        property_type: 'hostel',
        listing_type: 'regular',
        status: 'pending',
        verified: false,
        address_line: 'Plot 883, Sector 119 Kharar road',
        locality: 'Sector 119',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140301',
        monthly_rent: 4500,
        security_deposit: 3000,
        capacity: 12,
        available_beds: 12
      },
      {
        broker_email: 'broker3@gka.demo',
        owner_email: 'owner5@gka.demo',
        title: '[PENDING] Broker Tieup room in Landran Near College',
        description: 'Broker registered tie up room pending quick admin approval.',
        property_type: 'room',
        listing_type: 'broker_tie_up',
        status: 'pending',
        verified: false,
        address_line: 'House 22, Landran Crossing',
        locality: 'Landran',
        city: 'Mohali',
        state: 'Punjab',
        pincode: '140307',
        monthly_rent: 7000,
        security_deposit: 6000,
        brokerage_fee: 2500,
        capacity: 2,
        available_beds: 2
      },

      // REJECTED PROPERTIES
      {
        owner_email: 'owner8@gka.demo',
        title: '[REJECTED] Incomplete listings inside Chandigarh Sector 15',
        description: 'Rejected listing due to incorrect address and non-operational guidelines.',
        property_type: 'pg',
        listing_type: 'regular',
        status: 'rejected',
        verified: false,
        monthly_rent: 19000,
        security_deposit: 10000,
        pincode: '160015',
        capacity: 2,
        available_beds: 2
      },
      {
        owner_email: 'owner9@gka.demo',
        title: '[REJECTED] Unsafe flat with multiple rules in Sector 70 Mobile',
        description: 'Declined due to security and safety complaints on owner behavior historical reviews.',
        property_type: 'flat',
        listing_type: 'regular',
        status: 'rejected',
        verified: false,
        monthly_rent: 14000,
        security_deposit: 20000,
        pincode: '160059',
        capacity: 4,
        available_beds: 4
      },
      {
        owner_email: 'owner10@gka.demo',
        title: '[REJECTED] Empty Room on National Highway Landran',
        description: 'Rejected due to incomplete structural proof documents.',
        property_type: 'room',
        listing_type: 'regular',
        status: 'rejected',
        verified: false,
        monthly_rent: 3000,
        security_deposit: 3000,
        pincode: '140307',
        capacity: 2,
        available_beds: 2
      }
    ];

    const propertiesMap = {};
    let propertyIndex = 1;
    for (const p of propertiesData) {
      const ownerId = profilesMap[p.owner_email];
      const brokerId = p.broker_email ? profilesMap[p.broker_email] : null;

      const res = await client.query(`
        INSERT INTO properties (owner_id, broker_id, title, description, property_type, listing_type, status, verified, address_line, locality, city, state, pincode, monthly_rent, security_deposit, maintenance_fee, brokerage_fee, capacity, available_beds, gender_preference, available_from, amenities, rules)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        ON CONFLICT DO NOTHING
        RETURNING id, title;
      `, [
        ownerId, brokerId, p.title, p.description, p.property_type, p.listing_type, p.status, p.verified, p.address_line, p.locality, p.city, p.state, p.pincode, p.monthly_rent, p.security_deposit, p.maintenance_fee || 0, p.brokerage_fee || 0, p.capacity, p.available_beds, p.gender_preference || 'any', p.available_from || null, JSON.stringify(p.amenities || []), JSON.stringify(p.rules || {})
      ]);

      if (res.rows.length > 0) {
        propertiesMap[`property_${propertyIndex}`] = res.rows[0].id;
        propertyIndex++;
      }
    }

    // Seeding Property Media
    console.log(' - Seeding property media links...');
    const mediaUrls = [
      'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1505691938895-1758d7feb511?q=80&w=600&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=600&auto=format&fit=crop'
    ];

    const defaultYoutubeId = 'UfEiKK-iX70';

    for (let key in propertiesMap) {
      const propId = propertiesMap[key];

      await client.query(
        `DELETE FROM property_media WHERE property_id = $1`,
        [propId]
      );

      await client.query(`
        INSERT INTO property_media (property_id, file_url, file_type, is_cover, sort_order)
        VALUES ($1, $2, 'youtube', true, 0)
      `, [propId, defaultYoutubeId]);

      await client.query(`
        INSERT INTO property_media (property_id, file_url, file_type, is_cover, sort_order)
        VALUES ($1, $2, 'image', true, 1)
      `, [propId, mediaUrls[Math.floor(Math.random() * mediaUrls.length)]]);

      await client.query(`
        INSERT INTO property_media (property_id, file_url, file_type, is_cover, sort_order)
        VALUES ($1, $2, 'image', false, 2)
      `, [propId, mediaUrls[Math.floor(Math.random() * mediaUrls.length)]]);
    }

    // Seeding Roommate Preferences (Lifestyle Questionnaire)
    console.log(' - Seeding roommate questionnaires...');
    const tenants = [
      'tenant.search@gka.demo', 'tenant.active@gka.demo', 'tenant3@gka.demo', 'tenant4@gka.demo', 'tenant5@gka.demo'
    ];

    for (const email of tenants) {
      const uId = profilesMap[email];
      if (uId) {
        await client.query(`
          INSERT INTO roommate_preferences (user_id, budget_min, budget_max, preferred_city, preferred_localities, gender_preference, food_preference, smoking_preference, drinking_preference, sleep_schedule, cleanliness_level, study_preference, guest_preference, pets_preference)
          VALUES ($1, 4000, 10000, 'Mohali', '["Sector 119", "Landran"]', 'boys', 'veg', 'no', 'no', 'early', 'high', 'quiet', 'rarely', 'no')
          ON CONFLICT (user_id) DO NOTHING;
        `, [uId]);
      }
    }

    // Seeding Favorites (Wishlist)
    console.log(' - Seeding tenant favorites...');
    const rahulId = profilesMap['tenant.search@gka.demo'];
    if (rahulId && propertiesMap['property_1']) {
      await client.query(`
        INSERT INTO property_favorites (user_id, property_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING;
      `, [rahulId, propertiesMap['property_1']]);
    }
    if (rahulId && propertiesMap['property_2']) {
      await client.query(`
        INSERT INTO property_favorites (user_id, property_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING;
      `, [rahulId, propertiesMap['property_2']]);
    }

    // Seeding Contact Unlocks
    console.log(' - Seeding contact unlocks packs...');
    if (rahulId && propertiesMap['property_1']) {
      // Rahul has premium room unlocked
      await client.query(`
        INSERT INTO contact_unlocks (user_id, property_id, expires_at, is_active)
        VALUES ($1, $2, NOW() + INTERVAL '30 days', true) ON CONFLICT DO NOTHING;
      `, [rahulId, propertiesMap['property_1']]);
    }

    // Seeding Bookings
    console.log(' - Seeding bookings (confirmed / active / pending)...');
    const activeTenantId = profilesMap['tenant.active@gka.demo'];
    const owner1Id = profilesMap['owner1@gka.demo'];
    const owner2Id = profilesMap['owner2@gka.demo'];
    const activePropertyId = propertiesMap['property_1']; // Premium Room
    const secondPropertyId = propertiesMap['property_2']; // Budget PG

    let booking1Id = null;

    if (activeTenantId && owner1Id && activePropertyId) {
      // Active resident tenant प्रियंका सेन has verified active booking in Harminder's Single AC Room
      const resVal = await client.query(`
        INSERT INTO tenant_bookings (tenant_id, owner_id, property_id, status, monthly_rent, security_deposit, booking_amount, move_in_date, active_from, active_until)
        VALUES ($1, $2, $3, 'active', 9500, 8000, 5000, '2026-05-10', NOW() - INTERVAL '10 days', NOW() + INTERVAL '355 days')
        ON CONFLICT DO NOTHING
        RETURNING id;
      `, [activeTenantId, owner1Id, activePropertyId]);
      if (resVal.rows.length > 0) {
        booking1Id = resVal.rows[0].id;
      }
    }

    // Additional pending booking
    if (profilesMap['tenant3@gka.demo'] && owner2Id && secondPropertyId) {
      await client.query(`
        INSERT INTO tenant_bookings (tenant_id, owner_id, property_id, status, monthly_rent, security_deposit, booking_amount, move_in_date)
        VALUES ($1, $2, $3, 'pending', 5500, 4000, 2000, '2026-06-01')
        ON CONFLICT DO NOTHING;
      `, [profilesMap['tenant3@gka.demo'], owner2Id, secondPropertyId]);
    }

    // Seeding Visit Requests
    console.log(' - Seeding visit requests...');
    if (rahulId && owner2Id && secondPropertyId) {
      await client.query(`
        INSERT INTO property_visit_requests (tenant_id, owner_id, property_id, visit_date, visit_slot, status, note)
        VALUES ($1, $2, $3, '2026-05-25', '4 PM - 6 PM', 'requested', 'I want to see the cleaning level of the compound first.')
        ON CONFLICT DO NOTHING;
      `, [rahulId, owner2Id, secondPropertyId]);
    }

    if (activeTenantId && owner1Id && activePropertyId) {
      // Completed historic visit
      await client.query(`
        INSERT INTO property_visit_requests (tenant_id, owner_id, property_id, visit_date, visit_slot, status, note)
        VALUES ($1, $2, $3, '2026-05-08', '11 AM - 1 PM', 'completed', 'I loved the room orientation and ventilation.')
        ON CONFLICT DO NOTHING;
      `, [activeTenantId, owner1Id, activePropertyId]);
    }

    // Seeding Conversations
    console.log(' - Seeding chat sessions...');
    let conv1Id = null;
    let conv2Id = null;

    if (activeTenantId && owner1Id && activePropertyId) {
      // Active booked resident conversation (Fully unlocked)
      const resVal = await client.query(`
        INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message, last_message_at)
        VALUES ($1, $2, $3, 'unlocked', 'Please bring an photocopy of your identity card on your next visit.', NOW() - INTERVAL '1 hours')
        ON CONFLICT DO NOTHING
        RETURNING id;
      `, [activeTenantId, owner1Id, activePropertyId]);
      if (resVal.rows.length > 0) {
        conv1Id = resVal.rows[0].id;
      }
    }

    if (rahulId && owner2Id && secondPropertyId) {
      // Searcher conversation (Contact not unlocked / Preset templates only)
      const resVal = await client.query(`
        INSERT INTO conversations (tenant_id, owner_id, property_id, status, last_message, last_message_at)
        VALUES ($1, $2, $3, 'preset_only', 'Is this property still available?', NOW() - INTERVAL '3 hours')
        ON CONFLICT DO NOTHING
        RETURNING id;
      `, [rahulId, owner2Id, secondPropertyId]);
      if (resVal.rows.length > 0) {
        conv2Id = resVal.rows[0].id;
      }
    }

    // Seeding Conversation Messages
    console.log(' - Seeding detailed chat message histories...');
    if (conv1Id && activeTenantId && owner1Id) {
      await client.query(`
        INSERT INTO conversation_messages (conversation_id, sender_id, sender_type, body, created_at)
        VALUES 
          ($1, $2, 'tenant', 'Hello Sir, I have booked this single AC room. Exciting to move in!', NOW() - INTERVAL '4 days'),
          ($1, $3, 'owner', 'Welcome Priyanka! Sure, we are finishing the cleaning. You can move on date.', NOW() - INTERVAL '4 days'),
          ($1, $2, 'tenant', 'Is the water purifier working nicely?', NOW() - INTERVAL '2 days'),
          ($1, $3, 'owner', 'Yes, brand new Kent RO was installed last Sunday.', NOW() - INTERVAL '2 days'),
          ($1, $3, 'owner', 'Please bring an photocopy of your identity card on your next visit.', NOW() - INTERVAL '1 hours');
      `, [conv1Id, activeTenantId, owner1Id]);
    }

    if (conv2Id && rahulId && owner2Id) {
      await client.query(`
        INSERT INTO conversation_messages (conversation_id, sender_id, sender_type, body, is_template)
        VALUES 
          ($1, $2, 'tenant', 'Is this property still available?', true);
      `, [conv2Id, rahulId]);
    }

    // Seeding Message Templates
    console.log(' - Seeding preset message templates...');
    const presetTemplates = [
      { label: 'Is this property still available?', body: 'Is this property still available?', sender_type: 'tenant' },
      { label: 'Can I schedule a visit?', body: 'Can I schedule a visit?', sender_type: 'tenant' },
      { label: 'Is food included?', body: 'Is food included?', sender_type: 'tenant' },
      { label: 'Is deposit negotiable?', body: 'Is deposit negotiable?', sender_type: 'tenant' },
      { label: 'Can I move in this week?', body: 'Can I move in this week?', sender_type: 'tenant' },
      { label: 'Is electricity included?', body: 'Is electricity included?', sender_type: 'tenant' },
      { label: 'Is WiFi included?', body: 'Is WiFi included?', sender_type: 'tenant' },
      { label: 'Are visitors allowed?', body: 'Are visitors allowed?', sender_type: 'tenant' },

      { label: 'Yes, it is available.', body: 'Yes, it is available.', sender_type: 'owner' },
      { label: 'Please schedule a visit.', body: 'Please schedule a visit.', sender_type: 'owner' },
      { label: 'Food is included.', body: 'Food is included.', sender_type: 'owner' },
      { label: 'Deposit is fixed.', body: 'Deposit is fixed.', sender_type: 'owner' },
      { label: 'You can move in after verification.', body: 'You can move in after verification.', sender_type: 'owner' },
      { label: 'Electricity is charged separately.', body: 'Electricity is charged separately.', sender_type: 'owner' },
      { label: 'WiFi is included.', body: 'WiFi is included.', sender_type: 'owner' },
      { label: 'Visitors are allowed as per house rules.', body: 'Visitors are allowed as per house rules.', sender_type: 'owner' }
    ];

    for (const t of presetTemplates) {
      await client.query(`
        INSERT INTO message_templates (label, body, sender_type, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (sender_type, body) DO NOTHING;
      `, [t.label, t.body, t.sender_type]);
    }

    const defaultYoutubeId = process.env.DEFAULT_LISTING_YOUTUBE_ID || 'UfEiKK-iX70';
    const platformDefaults = [
      ['contact_unlock_standard_inr', '29'],
      ['contact_unlock_premium_inr', '49'],
      ['contact_unlock_days', '30'],
      ['lock_request_hide_days', '7'],
      ['default_listing_youtube_id', defaultYoutubeId],
      ['max_listing_photos', '12']
    ];
    for (const [key, val] of platformDefaults) {
      await client.query(
        `INSERT INTO platform_settings (key, value) VALUES ($1, to_jsonb($2::text)) ON CONFLICT (key) DO NOTHING`,
        [key, val]
      );
    }

    // Seeding Payments
    console.log(' - Seeding payments made...');
    if (activeTenantId && activePropertyId) {
      await client.query(`
        INSERT INTO payments (user_id, property_id, amount, platform_fee, currency, purpose, status, provider, provider_order_id, provider_payment_id)
        VALUES 
          ($1, $2, 9500, 150, 'INR', 'rent', 'paid', 'razorpay', 'order_rent_1001', 'pay_rent_3001'),
          ($1, $2, 8000, 100, 'INR', 'booking_fee', 'paid', 'razorpay', 'order_booking_2002', 'pay_booking_4002');
      `, [activeTenantId, activePropertyId]);
    }

    // Seeding Notifications
    console.log(' - Seeding recent user notifications...');
    if (rahulId) {
      await client.query(`
        INSERT INTO notifications (user_id, title, body, type, is_read)
        VALUES 
          ($1, 'Welcome to GharKaAdda!', 'Start discovering verified rooms around Tricity.', 'welcome', false),
          ($1, 'Visit Scheduled', 'Your visit to Budget Independent PG was scheduled on 2026-05-25.', 'visit', false);
      `, [rahulId]);
    }

    if (activeTenantId) {
      await client.query(`
        INSERT INTO notifications (user_id, title, body, type, is_read)
        VALUES 
          ($1, 'Booking Active!', 'Your booking for Premium AC Room has been verified as ACTIVE.', 'booking', false);
      `, [activeTenantId]);
    }

    // Seeding Reports
    console.log(' - Seeding user reported listings...');
    const reporterId = profilesMap['tenant4@gka.demo'];
    const offendingPropertyId = propertiesMap['property_3']; // Ivory apartments flat
    if (reporterId && offendingPropertyId) {
      await client.query(`
        INSERT INTO reports (reporter_id, property_id, reason, status)
        VALUES ($1, $2, 'Photos are duplicate search copies from other websites.', 'open')
        ON CONFLICT DO NOTHING;
      `, [reporterId, offendingPropertyId]);
    }

    // Seeding Maintenance Requests
    console.log(' - Seeding maintenance requests...');
    if (activeTenantId && owner1Id && activePropertyId && booking1Id) {
      await client.query(`
        INSERT INTO maintenance_requests (tenant_id, owner_id, property_id, booking_id, title, description, status, priority)
        VALUES 
          ($1, $2, $3, $4, 'AC Water Leakage', 'Water starts dropping from split AC indoor unit after 15 minutes of usage.', 'open', 'high'),
          ($1, $2, $3, $4, 'Bathroom bulb fused', 'Attached washroom LED bulb fused, need rapid light replacement.', 'resolved', 'normal');
      `, [activeTenantId, owner1Id, activePropertyId, booking1Id]);
    }

    // Seeding platform plan subscriptions & boosts
    console.log(' - Seeding plan subscriptions and boosts...');
    if (owner1Id && plansResult.rows.length > 0) {
      const ownerPlan = plansResult.rows.find(p => p.name === 'Premium Owner Plan');
      if (ownerPlan) {
        await client.query(`
          INSERT INTO subscriptions (user_id, plan_id, status, starts_at, ends_at)
          VALUES ($1, $2, 'active', NOW() - INTERVAL '3 days', NOW() + INTERVAL '27 days')
          ON CONFLICT DO NOTHING;
        `, [owner1Id, ownerPlan.id]);
      }
    }

    if (activePropertyId) {
      await client.query(`
        INSERT INTO property_boosts (property_id, boost_type, starts_at, ends_at, is_active)
        VALUES ($1, 'premium', NOW() - INTERVAL '3 days', NOW() + INTERVAL '27 days', true)
        ON CONFLICT DO NOTHING;
      `, [activePropertyId]);
    }

    // Commit Transaction
    await client.query('COMMIT');
    console.log('🎉 DB Transaction Commit Successful!');
    console.log('⭐ All GharKaAdda tables and sample data seeded successfully!');
    console.log('💡 Tip: Run "npm run db:sync" after setup to patch live DB (media order, chats, admin).');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during setup transaction! Rolling back changes...', err);
    process.exit(0);
  } finally {
    client.release();
    await pool.end();
    console.log('🔌 Pool connection shut down safely.');
  }
}

runSetup().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(0);
});
