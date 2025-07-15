const express = require('express');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const stockPath = path.join(__dirname, '..', 'stock.json');

// GET
router.get('/', (req, res, next) => {
  fs.readFile(stockPath, 'utf-8', (err, data) => {
    if (err) return next(err);
    res.json(JSON.parse(data || '[]'));
  });
});

// POST
router.post(
  '/',
  [
    body('codigo').notEmpty().withMessage('El campo "codigo" es obligatorio'),
    body('descripcion').notEmpty().withMessage('El campo "descripcion" es obligatorio')
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const nuevo = req.body;
    fs.readFile(stockPath, 'utf-8', (err, data) => {
      if (err) return next(err);
      let arr = [];
      try { arr = JSON.parse(data); } catch { return next(new Error('Error al parsear stock')); }
      arr.push(nuevo);
      fs.writeFile(stockPath, JSON.stringify(arr, null, 2), err => {
        if (err) return next(err);
        res.status(201).json({ mensaje: 'Reparación agregada' });
      });
    });
  }
);

module.exports = router;
