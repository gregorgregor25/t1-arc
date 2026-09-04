#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/srv/t1arc/tarvis-enrollment-poc}"
APP_DIR="$BASE_DIR/app"
SECRET_DIR="$BASE_DIR/secrets"
ENV_FILE="$APP_DIR/.env"

umask 077
mkdir -p "$APP_DIR" "$SECRET_DIR"
chmod 700 "$BASE_DIR" "$SECRET_DIR"

if [[ ! -e "$SECRET_DIR/ca-private-key.pem" ]]; then
  openssl genpkey \
    -algorithm EC \
    -pkeyopt ec_paramgen_curve:P-256 \
    -out "$SECRET_DIR/ca-private-key.pem"
  openssl req \
    -new \
    -x509 \
    -key "$SECRET_DIR/ca-private-key.pem" \
    -sha256 \
    -days 30 \
    -subj '/CN=T1 Arc TARV1S POC CA/O=T1 Arc Development' \
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -out "$SECRET_DIR/ca-certificate.pem"
  chmod 600 "$SECRET_DIR/ca-private-key.pem"
  chmod 644 "$SECRET_DIR/ca-certificate.pem"
fi

if [[ ! -e "$ENV_FILE" ]]; then
  bearer="$(openssl rand -hex 48)"
  zero_fingerprint="$(printf '%064d' 0)"
  cat > "$ENV_FILE" <<EOF
TARVIS_ENROLLMENT_BEARER_TOKEN=$bearer
TARVIS_ENROLLMENT_BIND_IP=127.0.0.1
TARVIS_ENROLLMENT_PORT=7314
TARVIS_ENROLLMENT_SECRET_DIR=$SECRET_DIR
TARVIS_ALLOWED_ATTESTATION_ROOT_SHA256=$zero_fingerprint
TARVIS_ALLOWED_ANDROID_PACKAGES=io.github.gregorgregor25.t1arc
TARVIS_ALLOWED_ANDROID_SIGNING_CERT_SHA256=$zero_fingerprint
TARVIS_ENROLLMENT_CHALLENGE_TTL_MS=120000
TARVIS_ENROLLMENT_CERTIFICATE_TTL_MS=300000
TARVIS_ENROLLMENT_MAX_CHALLENGES=1024
EOF
  chmod 600 "$ENV_FILE"
fi

cd "$APP_DIR"
docker compose build --pull
docker compose up -d
docker compose ps
openssl x509 \
  -in "$SECRET_DIR/ca-certificate.pem" \
  -noout \
  -fingerprint \
  -sha256
