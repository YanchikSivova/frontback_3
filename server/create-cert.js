const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

async function createCerts() {
  const attrs = [{ name: 'commonName', value: 'localhost' }];

  // 🔥 теперь с await
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256'
  });

  if (!pems || !pems.private || !pems.cert) {
    console.error('❌ Ошибка генерации сертификата:', pems);
    process.exit(1);
  }

  const certDir = path.join(__dirname, 'certs');

  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir);
  }

  fs.writeFileSync(
    path.join(certDir, 'localhost-key.pem'),
    pems.private,
    'utf8'
  );

  fs.writeFileSync(
    path.join(certDir, 'localhost-cert.pem'),
    pems.cert,
    'utf8'
  );

  console.log('✅ Сертификаты созданы в server/certs');
}

createCerts();