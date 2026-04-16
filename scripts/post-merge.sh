#!/bin/bash
set -e

npm install --prefer-offline --no-audit --no-fund

npm run db:push
