require('dotenv').config();
const { createApp } = require('./app');

const app = createApp();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Strežnik teče na http://localhost:${PORT}`);
  console.log(`Admin panel:     http://localhost:${PORT}/admin`);
  console.log(`Moj čas:         http://localhost:${PORT}/pin`);
  console.log(`Privzeto geslo:  kukman2024`);
});
