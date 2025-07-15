const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('¡Funciona Express!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Corriendo en', PORT));
