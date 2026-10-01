@AGENTS.md

## Робочий процес

- Завжди відповідай мені українською.
- Перед кожним push запускати `npm run lint`, `npm run typecheck`, `npm run build` і тести, пов'язані зі зміненими файлами (`node --experimental-strip-types --test <файли тестів>`).
- Push блокують лише нові помилки. Відомі старі падіння тестів записані в `docs/TODO.md` і push не блокують. Якщо зміна ламає ще якийсь тест або додає нову помилку lint, typecheck чи build — не пушити.
- Якщо перевірки проходять — зробити коміт із коротким описом українською та виконати `git push origin main`.
- Push у `main` автоматично оновлює staging-сайт через Cloudflare Workers Builds, тому ніколи не пушити з новими помилками.
- Не комітити `package.json` і `package-lock.json` без мого прямого прохання.
- Ніколи не виконувати `wrangler deploy`, міграції чи команди D1 з `--remote`.
