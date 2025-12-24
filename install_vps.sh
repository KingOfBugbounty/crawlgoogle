#!/bin/bash
# CrawlGoogle - Quick Install for VPS 104.234.84.127
# Author: ofjaaah

echo "[*] Abrindo porta 9876..."
sudo ufw allow 9876/tcp 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 9876 -j ACCEPT 2>/dev/null

echo "[*] Criando diretorio..."
mkdir -p ~/crawlgoogle && cd ~/crawlgoogle

echo "[*] Baixando server.py..."
curl -sL "https://raw.githubusercontent.com/ofjaaah/crawlgoogle/main/server.py" -o server.py 2>/dev/null || {
    echo "[!] Falha ao baixar. Copie manualmente o server.py"
}

echo "[*] Gerando certificado SSL para 104.234.84.127..."
openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout server.key -out server.crt -days 365 \
    -subj "/CN=104.234.84.127/O=CrawlGoogle/C=BR" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:104.234.84.127" 2>/dev/null

echo ""
echo "============================================"
echo "  Instalacao concluida!"
echo "============================================"
echo ""
echo "Para iniciar (HTTP):"
echo "  cd ~/crawlgoogle && python3 server.py --port 9876"
echo ""
echo "Na extensao Chrome, configure:"
echo "  IP: 104.234.84.127"
echo "  Porta: 9876"
echo ""
