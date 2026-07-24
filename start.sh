#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "نزّل Node.js الأول من https://nodejs.org (زرار LTS) وبعدين شغّل الملف ده تاني."
  exit 1
fi
node server.js
