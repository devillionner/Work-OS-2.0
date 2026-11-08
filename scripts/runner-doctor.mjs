// Перевірка готовності Android/Viber тією самою логікою, що й картка автопосту (`viber-android.mjs`, дія `status`): друкує одну JSON-
// відповідь `{status, reason, text}`. Використовує scripts/install-runner.sh --check; нічого не надсилає й не змінює в Viber.
import { VIBER_ENV_REASON_TEXT, runViberAndroid } from './viber-android.mjs';

try {
  const result = await runViberAndroid('status');
  const reason = result.reason || null;
  console.log(JSON.stringify({ status: result.status, reason, text: reason ? (VIBER_ENV_REASON_TEXT[reason] || result.detail || reason) : 'Viber готовий' }));
} catch (error) {
  console.log(JSON.stringify({ status: 'error', reason: 'doctor_failed', text: error instanceof Error ? error.message : String(error) }));
}
process.exit(0);
