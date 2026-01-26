#!/usr/bin/env bash
# خرج عند حدوث أي خطأ
set -o errexit

npm install
# تنصيب المتصفح اللازم لـ Puppeteer
npx puppeteer install
