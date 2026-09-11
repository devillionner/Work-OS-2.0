export type GoogleIdentityProfile = {
  subject: string;
  email: string;
  displayName: string;
  pictureUrl: string | null;
};

export type GoogleAuthPolicy = {
  ownerEmail: string;
  allowedEmails: ReadonlySet<string>;
};

export type AuthIdentityErrorCode =
  | 'not_allowed'
  | 'owner_not_initialized'
  | 'identity_owner_mismatch';

export class AuthIdentityError extends Error {
  readonly code: AuthIdentityErrorCode;

  constructor(code: AuthIdentityErrorCode, message: string) {
    super(message);
    this.name = 'AuthIdentityError';
    this.code = code;
  }
}

export function createGoogleAuthPolicy(
  ownerEmailRaw: string | undefined,
  allowedEmailsRaw: string | undefined,
): GoogleAuthPolicy | null {
  const ownerEmail = normalizeEmail(ownerEmailRaw);  if (!ownerEmail) return null;

  const allowedEmails = new Set<string>([ownerEmail]);
  for (const candidate of (allowedEmailsRaw || '').split(/[;,\n]/)) {
    const email = normalizeEmail(candidate);
    if (email) allowedEmails.add(email);
  }
  return { ownerEmail, allowedEmails };
}

export async function resolveGoogleIdentity(
  db: D1Database,
  profile: GoogleIdentityProfile,
  policy: GoogleAuthPolicy,
): Promise<string> {
  const email = normalizeEmail(profile.email);
  if (!email || !policy.allowedEmails.has(email)) {
    throw new AuthIdentityError(
      'not_allowed',
      'Цей Google-акаунт не має доступу до Work OS.',
    );
  }

  const existing = await db.prepare(
    `SELECT ai.user_id, u.email AS owner_email
     FROM auth_identities ai
     JOIN users u ON u.id = ai.user_id
     WHERE ai.provider = 'google' AND ai.provider_subject = ?1
     LIMIT 1`,
  ).bind(profile.subject).first<{ user_id: string; owner_email: string }>();
  const now = unixNow();
  if (existing) {
    if (normalizeEmail(existing.owner_email) !== policy.ownerEmail) {
      throw new AuthIdentityError(
        'identity_owner_mismatch',
        'Google-акаунт уже прив’язаний до іншого Work OS.',
      );
    }

    await db.batch([
      identityUpdate(db, profile, email, now),
      email === policy.ownerEmail
        ? db.prepare(
            `UPDATE users
             SET display_name=?1, picture_url=?2, last_login_at=?3
             WHERE id=?4`,
          ).bind(profile.displayName, profile.pictureUrl, now, existing.user_id)
        : db.prepare('UPDATE users SET last_login_at=?1 WHERE id=?2')
            .bind(now, existing.user_id),
    ]);
    return existing.user_id;
  }

  if (email === policy.ownerEmail) {
    await db.prepare(
      `INSERT INTO users (id,email,display_name,picture_url,created_at,last_login_at)
       VALUES (?1,?2,?3,?4,?5,?5)
       ON CONFLICT(email) DO UPDATE SET         display_name=excluded.display_name,
         picture_url=excluded.picture_url,
         last_login_at=excluded.last_login_at`,
    ).bind(
      profile.subject,
      email,
      profile.displayName,
      profile.pictureUrl,
      now,
    ).run();

    const owner = await db.prepare(
      'SELECT id FROM users WHERE email=?1 LIMIT 1',
    ).bind(policy.ownerEmail).first<{ id: string }>();
    if (!owner) throw new Error('Owner row was not created.');

    await identityInsert(db, profile, email, owner.id, now).run();
    return owner.id;
  }

  const owner = await db.prepare(
    'SELECT id FROM users WHERE email=?1 LIMIT 1',
  ).bind(policy.ownerEmail).first<{ id: string }>();
  if (!owner) {
    throw new AuthIdentityError(
      'owner_not_initialized',
      'Спочатку увійди основним Google-акаунтом власника.',
    );
  }

  await db.batch([    identityInsert(db, profile, email, owner.id, now),
    db.prepare('UPDATE users SET last_login_at=?1 WHERE id=?2')
      .bind(now, owner.id),
  ]);
  return owner.id;
}

function identityInsert(
  db: D1Database,
  profile: GoogleIdentityProfile,
  email: string,
  userId: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO auth_identities
       (provider,provider_subject,user_id,email,display_name,picture_url,created_at,last_login_at)
     VALUES ('google',?1,?2,?3,?4,?5,?6,?6)
     ON CONFLICT(provider,provider_subject) DO UPDATE SET
       email=excluded.email,
       display_name=excluded.display_name,
       picture_url=excluded.picture_url,
       last_login_at=excluded.last_login_at`,
  ).bind(
    profile.subject,
    userId,
    email,
    profile.displayName,
    profile.pictureUrl,
    now,
  );
}
function identityUpdate(
  db: D1Database,
  profile: GoogleIdentityProfile,
  email: string,
  now: number,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE auth_identities
     SET email=?1,display_name=?2,picture_url=?3,last_login_at=?4
     WHERE provider='google' AND provider_subject=?5`,
  ).bind(
    email,
    profile.displayName,
    profile.pictureUrl,
    now,
    profile.subject,
  );
}

function normalizeEmail(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
