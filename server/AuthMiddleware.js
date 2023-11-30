// server/AuthMiddleware.js

const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config(); // Cargar variables de entorno desde el archivo .env

function verifyToken(req, res, next) {
  const token = req.cookies.token; // Asegúrate de que estás usando 'cookie-parser'

  if (!token) {
    return res.status(403).json({ message: 'Acceso denegado. No se proporcionó token.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id; // Guarda el ID del tutor en el objeto de solicitud
    next();
  } catch (error) {
    console.error('Error al verificar el token:', error);
    res.status(401).json({ message: 'Token inválido.' });
  }
}

module.exports = verifyToken;
