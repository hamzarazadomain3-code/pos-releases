# Password Recovery — Code Generation Spec

Developer reference for Rokar POS password recovery. This is the document you
need to generate a support recovery code for a client over the phone.

> **Security reality check.** The HMAC key below is embedded in the shipped app
> (`src/main/services/recovery.ts`). `app.asar` is an archive, not encryption —
> anyone who unpacks the installer can read the key and mint codes for any shop.
> This mechanism stops a cashier, a curious family member, or a random person
> with the shop open. It does **not** stop a determined reverse-engineer.
> Per-device binding, single-use codes and lockouts raise the cost, but the
> honest description is *deterrence*, not cryptography. Real protection would
> require moving the key to `license-server`, which makes recovery online-only.

---

## 1. Support recovery code (Option B)

This is what a client needs when they have forgotten **both** their password and
their security answer.

### 1.1 How it is triggered in the app

Login screen → press **Ctrl + Shift + Alt + R** → confirm → "Support Recovery".
The screen displays the **Device ID**, the **Owner** name and the **Request #**.

### 1.2 Inputs

| Input | Where it comes from | Notes |
|---|---|---|
| `deviceId` | Client reads it off their Support Recovery screen | A UUID in `admin_settings.device_uuid`, generated once at first install |
| `ownerUsername` | Lowest-id active user with `role = 'owner'` | Almost always `admin` (created by migration 011) |
| `epoch` | The **Request #** on the same screen | Starts at `0`, in `admin_settings.support_epoch` |

**Always read all three values.** The request number increments every time a
code is used, so each code is genuinely single-use and the next one is always
well-defined. Generating a code for a stale request number will be rejected.

### 1.3 Key

The key is **not in this file, and not in any tracked source file.** This
repository is public; a committed key would let anyone mint a valid recovery
code for any shop and unlock their POS without the developer.

It lives in your local `.env` (gitignored) as `ROKAR_SUPPORT_KEY`:

```
ROKAR_SUPPORT_KEY=<64 hex characters>
```

Generate a fresh one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`npm run build` runs `scripts/gen-support-key.js`, which writes that value into
the gitignored `src/main/generated/supportKey.ts` before `tsc` runs. **Keep the
key stable across releases** — a client can only be unlocked by a code generated
with the key their installed build was compiled with. If you rotate it, existing
installations cannot be helped until they update.

**A build made without the key still compiles and runs.** Support Recovery is
simply disabled: `getSupportInfo().enabled` is `false`, the UI tells the user to
use "Forgot password?" instead, and `verifySupportCode` returns "Support Recovery
is not enabled in this build" rather than falsely calling every code invalid.
Option A does not use this key and is unaffected.

The key is still extractable from a built `app.asar` by anyone who unpacks the
installer, so Option B is **deterrence, not cryptography**. Real protection
requires the key to live on the license server, which makes recovery online-only.

### 1.4 Algorithm

```
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"      # Crockford base32

normalizeDeviceId(s) = s.replace(/[^0-9A-Za-z]/g, '').toUpperCase()

message = "rokar-recover-v1|" + normalizeDeviceId(deviceId)
        + "|" + ownerUsername.trim() + "|" + epoch
digest  = HMAC-SHA256(key = <the key above, as raw bytes>, message)     # 32 bytes

n = 0
for i in 0..4:                       # first 5 bytes = 40 bits, big-endian
    n = n * 256 + digest[i]

chars = ""
for i in 7 down to 0:                # 8 base32 chars, most-significant first
    chars += ALPHABET[(n >>> (5*i)) & 31]

code = chars[0:4] + "-" + chars[4:8]  # "XXXX-XXXX"
```

The key hex string must be decoded to **raw bytes** before use as the HMAC key —
do not use the 64-char ASCII hex string as the key.

There is deliberately **no timestamp** in the message: the device clock may be
wrong, and "one time only" is enforced by the `epoch` counter instead.

### 1.5 Properties

- 40 bits of entropy from a 256-bit HMAC output
- Crockford base32 omits `I`, `L`, `O`, `U` so codes survive being read aloud
- Hyphens and letter case are stripped before comparison, so `P1B2-18NQ`,
  `p1b2-18nq` and `P1B218NQ` are all accepted
- A code only works on the device it was generated for, only for the request
  number it was generated for, and only once

### 1.6 Generating a code

Use the bundled CLI (it is not shipped to clients — `build.files` in
`package.json` excludes `tools/`):

```powershell
node tools/recovery-code-cli.js <device-id> <request-number> [owner-username]
node tools/recovery-code-cli.js          # interactive
```

```
$ node tools/recovery-code-cli.js d4ae2d45-779c-4fec-afce-75ace6b86d60 2 admin
  ────────────────────────────────────────
  Device    : D4AE2D45779C4FECAFCE75ACE6B86D60
  Owner     : admin
  Request # : 2
  CODE      : A102-YNAP
  ────────────────────────────────────────
```

Or implement it yourself in any language — the reference implementation is
`computeSupportCode()` in `src/main/services/recovery.ts`:

```python
import hmac, hashlib, os

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
# Your ROKAR_SUPPORT_KEY from .env — 64 hex chars, decoded to raw bytes.
KEY = bytes.fromhex(os.environ["ROKAR_SUPPORT_KEY"])

def code(device_id, request_number, owner="admin"):
    dev = "".join(c for c in device_id if c.isalnum()).upper()
    msg = f"rokar-recover-v1|{dev}|{owner.strip()}|{int(request_number)}".encode()
    d = hmac.new(KEY, msg, hashlib.sha256).digest()
    n = int.from_bytes(d[:5], "big")
    chars = "".join(ALPHABET[(n >> (5 * i)) & 31] for i in range(7, -1, -1))
    return f"{chars[:4]}-{chars[4:]}"
```

### 1.7 Support-call script

1. Client forgot their password.
2. First try **Option A** — "Forgot password?" on the login screen, security
   question or recovery code. This resolves the majority of calls.
3. If that fails, walk them through **Ctrl + Shift + Alt + R** on the login screen.
4. They read you three things: the **Device ID**, the **Owner** name and the
   **Request #**.
5. You run `node tools/recovery-code-cli.js <device-id> <request-number> [owner]`.
6. They type the code, set a new password, sign in. Their Request # goes up by 1.
7. Next time they call, re-read all three values — the old code will not work.
8. Ask them to set a recovery question and write down the recovery code.

### 1.8 Rate limits

Both recovery paths lock out for 10 minutes after 5 consecutive failures.
Counters live in the `recovery_lockout` table (keys `answer` and `support`) so
restarting the app does not clear them.

---

## 2. Owner recovery code (Option A)

A separate code the **shop owner** sets up themselves, for the case where they
remember a written code but not the answer to their security question. It is
derived, never stored, so there is no plaintext master code in the database.

```
salt    = admin_settings.recovery_salt        # random 16 bytes hex, created on demand
message = "rokar-master|" + normalizeDeviceId(deviceId) + "|" + ownerUsername.trim()
digest  = HMAC-SHA256(key = <salt, as raw bytes>, message)

code = same Crockford base32 encoding as §1.4 (but over the whole digest, not the key)
```

**You do not need this.** The owner sees it in *Users → Recovery & Security* and
writes it down. "Generate a new code" rotates `recovery_salt`, immediately
invalidating the old one.

---

## 3. Security answer hashing

Answers are stored hashed, never in plain text, under a **different salt from
passwords**:

```
normalizeAnswer(s) = s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
answerHash(a)      = scryptSync(normalizeAnswer(a), 'pos-recovery-salt', 64).toString('hex')
```

Passwords use `scryptSync(secret, 'pos-salt', 64)`. The salts must stay
different: they are both app-wide constants, so a shared salt would put answers
and passwords in the same hash domain and an answer hash could be presented as a
password hash. `scripts/test_recovery.js` asserts this.

Case and extra spaces are ignored when the answer is typed back in, because it
is free text a human retypes. Do not change this behaviour on one side only —
`normalizeAnswer` is used for both storing and verifying.

---

## 4. Rotating the support key

Changing the key invalidates every code issued under the old one and requires a
new build:

1. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Split it into two 32-char halves, reverse the order, and update `_K1` / `_K2`
   in `src/main/services/recovery.ts`.
3. Update `KEY` in `tools/recovery-code-cli.js`.
4. Update the key in this document.
5. `npm run build && npm run package`.

---

## 5. Testing

```powershell
npm run test:recovery
```

47 checks, including CLI/service code parity, answer/password hash domain
separation, lockout at 5 failures, wrong-code rejection, cross-device rejection,
single-use enforcement, and that the **same shop can be recovered three times in
a row** (the regression the request-number counter exists to prevent).

The app also refuses an empty normalised code — a user typing `"!!!!"`
normalises to `""`, which would otherwise match an unset expected value.