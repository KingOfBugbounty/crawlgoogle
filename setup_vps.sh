#!/bin/bash
# CrawlGoogle VPS Setup Script
# Author: ofjaaah
# Usage: ./setup_vps.sh [port]

set -e

PORT=${1:-9876}
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')

echo "=============================================="
echo "  CrawlGoogle VPS Setup - by ofjaaah"
echo "=============================================="
echo ""
echo "Detected VPS IP: $VPS_IP"
echo "Port: $PORT"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "[!] Run as root for firewall configuration"
    SUDO="sudo"
else
    SUDO=""
fi

# Open firewall port
echo "[*] Opening firewall port $PORT..."
if command -v ufw &> /dev/null; then
    $SUDO ufw allow $PORT/tcp 2>/dev/null || true
    echo "[+] UFW: Port $PORT opened"
elif command -v firewall-cmd &> /dev/null; then
    $SUDO firewall-cmd --permanent --add-port=$PORT/tcp 2>/dev/null || true
    $SUDO firewall-cmd --reload 2>/dev/null || true
    echo "[+] firewalld: Port $PORT opened"
elif command -v iptables &> /dev/null; then
    $SUDO iptables -I INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null || true
    echo "[+] iptables: Port $PORT opened"
fi

# Generate SSL certificate with VPS IP
echo "[*] Generating SSL certificate for IP: $VPS_IP..."

cat > /tmp/openssl_vps.cnf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = BR
O = CrawlGoogle
CN = $VPS_IP

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
IP.2 = $VPS_IP
IP.3 = 0.0.0.0
EOF

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout server.key \
    -out server.crt \
    -days 365 \
    -config /tmp/openssl_vps.cnf 2>/dev/null

rm -f /tmp/openssl_vps.cnf

echo "[+] Certificate created for IP: $VPS_IP"

# Verify certificate
echo ""
echo "[*] Certificate details:"
openssl x509 -in server.crt -noout -subject -dates | head -3
echo ""
openssl x509 -in server.crt -noout -ext subjectAltName 2>/dev/null || true

echo ""
echo "=============================================="
echo "  Setup Complete!"
echo "=============================================="
echo ""
echo "To start the server (HTTP - recommended):"
echo "  python3 server.py --port $PORT"
echo ""
echo "To start the server (HTTPS):"
echo "  python3 server.py --port $PORT --https"
echo ""
echo "In your Chrome extension, configure:"
echo "  VPS IP: $VPS_IP"
echo "  Port: $PORT"
echo ""
echo "Test connection from browser:"
echo "  http://$VPS_IP:$PORT/ping"
echo ""
