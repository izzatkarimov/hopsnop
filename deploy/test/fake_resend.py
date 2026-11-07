"""Stand-in for api.resend.com in the local proof only (deploy/test/README.md).

`make-certs` prints a throwaway CA and a certificate for api.resend.com as JSON;
`serve` answers POST /emails like Resend and prints each email as one JSON line.
"""

import datetime
import http.server
import json
import os
import ssl
import sys
import uuid

CERT_DIR = "/run/fake-resend"


def make_certs() -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    now = datetime.datetime.now(datetime.UTC)
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Hopsnop local proof CA")])
    ca = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True,
                crl_sign=True, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "api.resend.com")]))
        .issuer_name(ca_name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("api.resend.com")]), critical=False)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    pem = serialization.Encoding.PEM
    print(json.dumps({
        "ca.pem": ca.public_bytes(pem).decode(),
        "cert.pem": cert.public_bytes(pem).decode(),
        "key.pem": key.private_bytes(
            pem, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode(),
    }))


class ResendLike(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        expected = f"Bearer {os.environ['EXPECTED_API_KEY']}"
        authorized = self.headers.get("Authorization") == expected
        print(json.dumps({
            "authorized": authorized,
            "path": self.path,
            "from": body.get("from"),
            "to": body.get("to"),
            "subject": body.get("subject"),
            "text": body.get("text"),
        }), flush=True)
        ok = authorized and self.path == "/emails"
        reply = {"id": str(uuid.uuid4())} if ok else {"message": "API key is invalid"}
        data = json.dumps(reply).encode()
        self.send_response(200 if ok else 401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        pass


def serve() -> None:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(f"{CERT_DIR}/cert.pem", f"{CERT_DIR}/key.pem")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 443), ResendLike)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == "__main__":
    make_certs() if sys.argv[1:] == ["make-certs"] else serve()
