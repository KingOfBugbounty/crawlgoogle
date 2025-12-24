#!/usr/bin/env python3
"""
CrawlGoogle Server - Receives domains from Chrome extension
Author: ofjaaah

Usage:
    # HTTP (default)
    python3 server.py --port 9876

    # HTTPS with auto-generated self-signed certificate
    python3 server.py --port 9876 --https

    # HTTPS with custom certificate
    python3 server.py --port 9876 --https --cert cert.pem --key key.pem

    # With custom output file
    python3 server.py --port 9876 -o /path/to/domains.txt

    # Stop a running server
    python3 server.py --stop

The server saves domains to domains_collected.txt in the current directory.
"""

import argparse
import json
import os
import re
import signal
import ssl
import subprocess
import sys
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

# ANSI colors for terminal output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

# Default output path
DEFAULT_OUTPUT = "domains_collected.txt"

# Blocked domains (social media, big tech)
BLOCKED_DOMAINS = [
    # Meta/Facebook
    'facebook.com', 'fb.com', 'fbcdn.net', 'facebook.net', 'fbsbx.com',
    'messenger.com', 'instagram.com', 'whatsapp.com', 'whatsapp.net',
    'meta.com', 'oculus.com', 'workplace.com', 'threads.net',
    # Twitter/X
    'twitter.com', 'x.com', 't.co', 'twimg.com', 'tweetdeck.com',
    # LinkedIn
    'linkedin.com', 'licdn.com', 'lnkd.in',
    # Microsoft
    'microsoft.com', 'msn.com', 'live.com', 'outlook.com', 'office.com',
    'office365.com', 'azure.com', 'bing.com', 'windowsupdate.com',
    'microsoftonline.com', 'sharepoint.com', 'onedrive.com', 'xbox.com',
    'skype.com', 'hotmail.com', 'visualstudio.com', 'github.com',
    'githubusercontent.com', 'githubassets.com', 'npmjs.com',
    # Amazon
    'amazon.com', 'amazon.com.br', 'amazon.co.uk', 'amazon.de', 'amazon.fr',
    'amazon.es', 'amazon.it', 'amazon.ca', 'amazon.co.jp', 'amazon.in',
    'amazonaws.com', 'awsstatic.com', 'aws.amazon.com', 'cloudfront.net',
    'amzn.to', 'a2z.com', 'twitch.tv', 'imdb.com',
    # Other social media
    'tiktok.com', 'snapchat.com', 'pinterest.com', 'reddit.com',
    'discord.com', 'discord.gg', 'telegram.org', 't.me',
    # Shopify
    'shopify.com', 'myshopify.com', 'shopifycdn.com', 'shopifysvc.com',
    # Test/Example domains
    'example.org', 'example.com', 'example.net', 'test.com', 'test.org',
]

# Statistics
stats = {
    'total_received': 0,
    'unique_domains': 0,
    'requests': 0,
    'start_time': None
}
stats_lock = threading.Lock()

# PID file path (set in main)
pid_file_path = None


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle requests in separate threads"""
    daemon_threads = True


class DomainHandler(BaseHTTPRequestHandler):
    output_file = DEFAULT_OUTPUT
    server_version = "CrawlGoogle/2.0"

    def log_message(self, format, *args):
        timestamp = datetime.now().strftime("%H:%M:%S")
        method = args[0].split()[0] if args else "?"
        path = args[0].split()[1] if args and len(args[0].split()) > 1 else "?"
        status = args[1] if len(args) > 1 else "?"

        # Color code by status
        if str(status).startswith('2'):
            status_color = Colors.GREEN
        elif str(status).startswith('4'):
            status_color = Colors.YELLOW
        else:
            status_color = Colors.RED

        print(f"{Colors.CYAN}[{timestamp}]{Colors.ENDC} {Colors.BOLD}{method}{Colors.ENDC} {path} {status_color}{status}{Colors.ENDC}")

    def send_cors_headers(self):
        """Send CORS headers to allow requests from Chrome extension"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With')
        self.send_header('Access-Control-Max-Age', '86400')

    def send_json_response(self, status_code, data):
        """Helper to send JSON responses"""
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        """Handle GET requests"""
        global stats

        with stats_lock:
            stats['requests'] += 1

        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == '/ping' or path == '/health':
            uptime = None
            if stats['start_time']:
                uptime = str(datetime.now() - stats['start_time']).split('.')[0]

            response = {
                'status': 'ok',
                'message': 'CrawlGoogle Server is running',
                'author': 'ofjaaah',
                'version': '2.0',
                'uptime': uptime,
                'stats': {
                    'total_received': stats['total_received'],
                    'unique_domains': stats['unique_domains'],
                    'requests': stats['requests']
                }
            }
            self.send_json_response(200, response)

        elif path == '/domains':
            # Return current domains with optional pagination
            query_params = parse_qs(parsed_path.query)
            limit = int(query_params.get('limit', [0])[0])
            offset = int(query_params.get('offset', [0])[0])

            domains = []
            if os.path.exists(self.output_file):
                with open(self.output_file, 'r', encoding='utf-8') as f:
                    domains = [line.strip() for line in f if line.strip()]

            total = len(domains)

            if limit > 0:
                domains = domains[offset:offset + limit]

            response = {
                'status': 'ok',
                'count': len(domains),
                'total': total,
                'offset': offset,
                'domains': domains
            }
            self.send_json_response(200, response)

        elif path == '/stats':
            unique_count = 0
            if os.path.exists(self.output_file):
                with open(self.output_file, 'r', encoding='utf-8') as f:
                    unique_count = sum(1 for line in f if line.strip())

            uptime = None
            if stats['start_time']:
                uptime = str(datetime.now() - stats['start_time']).split('.')[0]

            response = {
                'status': 'ok',
                'total_domains': unique_count,
                'total_received': stats['total_received'],
                'requests': stats['requests'],
                'uptime': uptime,
                'output_file': os.path.abspath(self.output_file)
            }
            self.send_json_response(200, response)

        elif path == '/export':
            # Export domains as plain text
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="domains.txt"')
            self.send_cors_headers()
            self.end_headers()

            if os.path.exists(self.output_file):
                with open(self.output_file, 'rb') as f:
                    self.wfile.write(f.read())

        elif path == '/export/json':
            # Export domains as JSON
            domains = []
            if os.path.exists(self.output_file):
                with open(self.output_file, 'r', encoding='utf-8') as f:
                    domains = [line.strip() for line in f if line.strip()]

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="domains.json"')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'domains': domains}, indent=2).encode('utf-8'))

        else:
            self.send_json_response(404, {'error': 'Not found', 'available_endpoints': [
                'GET /ping', 'GET /domains', 'GET /stats', 'GET /export',
                'POST /domains', 'POST /clear'
            ]})

    def do_POST(self):
        """Handle POST requests"""
        global stats

        with stats_lock:
            stats['requests'] += 1

        if self.path == '/domains':
            content_length = int(self.headers.get('Content-Length', 0))

            if content_length == 0:
                self.send_json_response(400, {'error': 'Empty request body'})
                return

            if content_length > 10 * 1024 * 1024:  # 10MB limit
                self.send_json_response(413, {'error': 'Request too large'})
                return

            try:
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))
                domains = data.get('domains', [])

                if not domains:
                    self.send_json_response(400, {'error': 'No domains provided'})
                    return

                if not isinstance(domains, list):
                    self.send_json_response(400, {'error': 'Domains must be a list'})
                    return

                # Read existing domains
                existing_domains = set()
                if os.path.exists(self.output_file):
                    with open(self.output_file, 'r', encoding='utf-8') as f:
                        existing_domains = set(line.strip() for line in f if line.strip())

                # Process and add new unique items (domains or URLs)
                new_domains = []
                for item in domains:
                    cleaned = self.clean_item(item)
                    if cleaned and cleaned not in existing_domains:
                        existing_domains.add(cleaned)
                        new_domains.append(cleaned)

                # Write all domains to file
                output_dir = os.path.dirname(self.output_file)
                if output_dir:
                    os.makedirs(output_dir, exist_ok=True)

                with open(self.output_file, 'w', encoding='utf-8') as f:
                    for domain in sorted(existing_domains):
                        f.write(f"{domain}\n")

                # Update stats
                with stats_lock:
                    stats['total_received'] += len(domains)
                    stats['unique_domains'] = len(existing_domains)

                self.send_json_response(200, {
                    'status': 'ok',
                    'received': len(domains),
                    'new_domains': len(new_domains),
                    'total_domains': len(existing_domains),
                    'message': f'Added {len(new_domains)} new domains'
                })

                # Log new domains
                if new_domains:
                    print(f"    {Colors.GREEN}+{len(new_domains)} new domains:{Colors.ENDC}")
                    for d in new_domains[:10]:
                        print(f"      {Colors.CYAN}{d}{Colors.ENDC}")
                    if len(new_domains) > 10:
                        print(f"      {Colors.YELLOW}... and {len(new_domains) - 10} more{Colors.ENDC}")
                else:
                    print(f"    {Colors.YELLOW}No new unique domains (all duplicates){Colors.ENDC}")

            except json.JSONDecodeError as e:
                self.send_json_response(400, {'error': f'Invalid JSON: {str(e)}'})

            except Exception as e:
                print(f"    {Colors.RED}Error: {str(e)}{Colors.ENDC}")
                self.send_json_response(500, {'error': str(e)})

        elif self.path == '/clear':
            # Clear all domains
            if os.path.exists(self.output_file):
                os.remove(self.output_file)

            with stats_lock:
                stats['unique_domains'] = 0

            self.send_json_response(200, {'status': 'ok', 'message': 'All domains cleared'})
            print(f"    {Colors.YELLOW}All domains cleared{Colors.ENDC}")

        else:
            self.send_json_response(404, {'error': 'Not found'})

    def clean_item(self, item):
        """Clean and validate a domain or URL"""
        if not item or not isinstance(item, str):
            return None

        item = str(item).strip()

        # Check if it's a full URL (has protocol and path)
        is_url = item.startswith('http://') or item.startswith('https://')

        if is_url:
            # It's a URL - clean it but preserve path
            return self.clean_url(item)
        else:
            # It's a domain - use domain cleaning
            return self.clean_domain(item)

    def clean_url(self, url):
        """Clean and validate a full URL"""
        try:
            url = url.strip()
            parsed = urlparse(url)

            # Get domain for validation
            domain = parsed.hostname.lower() if parsed.hostname else None
            if not domain:
                return None

            # Remove www prefix from domain
            if domain.startswith('www.'):
                domain = domain[4:]

            # Validate domain
            if len(domain) < 4 or len(domain) > 253:
                return None

            if '.' not in domain:
                return None

            domain_regex = r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
            if not re.match(domain_regex, domain):
                return None

            # Check blocked domains
            if self.is_blocked_domain(domain):
                return None

            # Reconstruct clean URL (protocol + domain + path, no query/fragment)
            scheme = parsed.scheme or 'https'
            path = parsed.path.rstrip('/') if parsed.path and parsed.path != '/' else ''

            clean_url = f"{scheme}://{domain}{path}"
            return clean_url

        except Exception:
            return None

    def clean_domain(self, domain):
        """Clean and validate a domain"""
        if not domain or not isinstance(domain, str):
            return None

        domain = str(domain).strip().lower()

        # Remove protocol if present
        if domain.startswith('http://'):
            domain = domain[7:]
        elif domain.startswith('https://'):
            domain = domain[8:]

        # Remove path if present
        domain = domain.split('/')[0]

        # Remove port if present
        domain = domain.split(':')[0]

        # Remove www. prefix
        if domain.startswith('www.'):
            domain = domain[4:]

        # Basic validation
        if len(domain) < 4 or len(domain) > 253:
            return None

        if not '.' in domain:
            return None

        # Domain regex validation
        domain_regex = r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
        if not re.match(domain_regex, domain):
            return None

        # Check against blocked domains (social media, big tech)
        if self.is_blocked_domain(domain):
            return None

        return domain

    def is_blocked_domain(self, domain):
        """Check if domain is in the blocked list"""
        for blocked in BLOCKED_DOMAINS:
            if domain == blocked or domain.endswith('.' + blocked):
                return True
        return False


def generate_self_signed_cert(cert_path, key_path):
    """Generate a self-signed certificate for HTTPS"""
    print(f"{Colors.YELLOW}[*] Generating self-signed certificate...{Colors.ENDC}")

    try:
        subprocess.run(['openssl', 'version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print(f"{Colors.RED}[!] OpenSSL not found. Please install it or provide your own certificate.{Colors.ENDC}")
        sys.exit(1)

    cmd = [
        'openssl', 'req', '-x509', '-newkey', 'rsa:4096',
        '-keyout', key_path,
        '-out', cert_path,
        '-days', '365',
        '-nodes',
        '-subj', '/CN=CrawlGoogle/O=ofjaaah/C=BR'
    ]

    try:
        subprocess.run(cmd, capture_output=True, check=True)
        print(f"{Colors.GREEN}[+] Certificate generated: {cert_path}{Colors.ENDC}")
        print(f"{Colors.GREEN}[+] Private key generated: {key_path}{Colors.ENDC}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"{Colors.RED}[!] Failed to generate certificate: {e}{Colors.ENDC}")
        return False


def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    global pid_file_path
    print(f"\n{Colors.YELLOW}[*] Shutting down...{Colors.ENDC}")

    # Remove PID file
    if pid_file_path and os.path.exists(pid_file_path):
        try:
            os.remove(pid_file_path)
        except Exception:
            pass

    # Print final stats
    if stats['start_time']:
        uptime = str(datetime.now() - stats['start_time']).split('.')[0]
        print(f"\n{Colors.HEADER}Final Statistics:{Colors.ENDC}")
        print(f"  Uptime: {uptime}")
        print(f"  Total requests: {stats['requests']}")
        print(f"  Domains received: {stats['total_received']}")
        print(f"  Unique domains: {stats['unique_domains']}")

    sys.exit(0)


def main():
    global stats, pid_file_path

    parser = argparse.ArgumentParser(
        description='CrawlGoogle Server - Receive domains from Chrome extension',
        epilog='Author: ofjaaah',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '-p', '--port',
        type=int,
        default=9876,
        help='Port to listen on (default: 9876)'
    )
    parser.add_argument(
        '-o', '--output',
        type=str,
        default=DEFAULT_OUTPUT,
        help=f'Output file path (default: {DEFAULT_OUTPUT})'
    )
    parser.add_argument(
        '-b', '--bind',
        type=str,
        default='0.0.0.0',
        help='Address to bind to (default: 0.0.0.0)'
    )
    parser.add_argument(
        '--https',
        action='store_true',
        help='Enable HTTPS (auto-generates self-signed cert if not provided)'
    )
    parser.add_argument(
        '--cert',
        type=str,
        default='server.crt',
        help='Path to SSL certificate (default: server.crt)'
    )
    parser.add_argument(
        '--key',
        type=str,
        default='server.key',
        help='Path to SSL private key (default: server.key)'
    )
    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Enable verbose logging'
    )
    parser.add_argument(
        '--stop',
        action='store_true',
        help='Stop a running server'
    )
    parser.add_argument(
        '--pid-file',
        type=str,
        default=None,
        help='PID file path (default: /tmp/crawlgoogle_server_<port>.pid)'
    )

    args = parser.parse_args()

    # Set default PID file based on port
    if args.pid_file is None:
        args.pid_file = f'/tmp/crawlgoogle_server_{args.port}.pid'

    # Handle --stop argument
    if args.stop:
        stopped = False

        # First try PID file
        if os.path.exists(args.pid_file):
            try:
                with open(args.pid_file, 'r') as f:
                    pid = int(f.read().strip())
                os.kill(pid, signal.SIGTERM)
                os.remove(args.pid_file)
                print(f"{Colors.GREEN}[+] Server (PID {pid}) stopped successfully{Colors.ENDC}")
                stopped = True
            except ProcessLookupError:
                print(f"{Colors.YELLOW}[!] Server process not found. Removing stale PID file.{Colors.ENDC}")
                os.remove(args.pid_file)
            except Exception as e:
                print(f"{Colors.RED}[!] Error stopping server via PID file: {e}{Colors.ENDC}")

        # If PID file didn't work, try to find process by port
        if not stopped:
            try:
                result = subprocess.run(
                    ['ss', '-tlnp'],
                    capture_output=True,
                    text=True
                )
                for line in result.stdout.split('\n'):
                    if f':{args.port}' in line and 'python' in line:
                        # Extract PID from the line (format: pid=XXXXX)
                        match = re.search(r'pid=(\d+)', line)
                        if match:
                            pid = int(match.group(1))
                            os.kill(pid, signal.SIGTERM)
                            print(f"{Colors.GREEN}[+] Server (PID {pid}) on port {args.port} stopped successfully{Colors.ENDC}")
                            stopped = True
                            break
            except Exception as e:
                print(f"{Colors.RED}[!] Error finding process by port: {e}{Colors.ENDC}")

        if not stopped:
            print(f"{Colors.YELLOW}[!] No server running on port {args.port}{Colors.ENDC}")
            sys.exit(1)

        sys.exit(0)

    # Set up signal handler
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    DomainHandler.output_file = args.output

    # Ensure output directory exists
    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Count existing domains
    existing_count = 0
    if os.path.exists(args.output):
        with open(args.output, 'r', encoding='utf-8') as f:
            existing_count = sum(1 for line in f if line.strip())

    stats['unique_domains'] = existing_count
    stats['start_time'] = datetime.now()

    # Save PID file
    pid_file_path = args.pid_file
    with open(pid_file_path, 'w') as f:
        f.write(str(os.getpid()))

    server_address = (args.bind, args.port)
    httpd = ThreadedHTTPServer(server_address, DomainHandler)

    protocol = 'HTTP'

    # Setup HTTPS if requested
    if args.https:
        protocol = 'HTTPS'

        if not os.path.exists(args.cert) or not os.path.exists(args.key):
            if not generate_self_signed_cert(args.cert, args.key):
                print(f"{Colors.YELLOW}[!] Falling back to HTTP{Colors.ENDC}")
                protocol = 'HTTP'
            else:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(args.cert, args.key)
                httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        else:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(args.cert, args.key)
            httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    output_abs = os.path.abspath(args.output)

    print(f"""
{Colors.RED}╔═══════════════════════════════════════════════════════════╗
║              CrawlGoogle Server - by ofjaaah              ║
╠═══════════════════════════════════════════════════════════╣{Colors.ENDC}
{Colors.CYAN}║  Protocol:   {protocol:<44}║
║  Listening:  {args.bind}:{args.port:<37}║
║  Output:     {output_abs:<44}║{Colors.ENDC}
{Colors.GREEN}║  Existing:   {existing_count} domains{' '*(38-len(str(existing_count)))}║{Colors.ENDC}
{Colors.RED}╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║{Colors.ENDC}
{Colors.YELLOW}║    GET  /ping    - Health check                           ║
║    GET  /domains - List all domains                       ║
║    GET  /stats   - Get statistics                         ║
║    GET  /export  - Download domains.txt                   ║
║    POST /domains - Add new domains                        ║
║    POST /clear   - Clear all domains                      ║{Colors.ENDC}
{Colors.RED}╚═══════════════════════════════════════════════════════════╝{Colors.ENDC}
    """)

    if args.https:
        print(f"{Colors.CYAN}[*] HTTPS URL: https://{args.bind}:{args.port}{Colors.ENDC}")
        print(f"{Colors.YELLOW}[!] Note: Browser may warn about self-signed certificate{Colors.ENDC}")
    else:
        print(f"{Colors.CYAN}[*] HTTP URL: http://{args.bind}:{args.port}{Colors.ENDC}")

    print(f"\n{Colors.GREEN}[*] Waiting for domains... (Ctrl+C to stop){Colors.ENDC}\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        signal_handler(None, None)


if __name__ == '__main__':
    main()
