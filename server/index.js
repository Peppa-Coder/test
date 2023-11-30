const express = require('express');
const app = express();
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createTcpPool, registerUser, loginUser } = require('./db.js');

app.use(cors({
    origin: 'https://a2ef-2803-c180-2002-b56e-84a5-7d2a-6b78-51d9.ngrok-free.app/', // Reemplaza con tu dominio
    credentials: true,
}));

app.use(express.json());

createTcpPool().then(() => {
    app.listen(3001, () => {
        console.log('Aplicación escuchando en el puerto 3001!');
    });
}).catch((error) => {
    console.error('Error al conectar a la base de datos:', error);
});

app.get('/', (req, res) => {
    res.send('Hola Mundo!');
});

app.post('/api/register', async (req, res) => {
    const { nombreUsuario, email, contrasena } = req.body;
    const hashedPassword = await bcrypt.hash(contrasena, 10);
    
    try {
        const userId = await registerUser(nombreUsuario, email, hashedPassword);
        res.status(201).json({ message: 'Usuario registrado correctamente', userId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, contrasena } = req.body;
    
    try {
        const userId = await loginUser(email, contrasena);
        const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
            expiresIn: '1d',
        });

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV !== 'development',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000,
        });

        res.json({
            message: 'Inicio de sesión exitoso',
            userId: userId
        });
    } catch (error) {
        console.error(error);
        const status = error.message === 'Usuario no encontrado.' || error.message === 'Contraseña incorrecta.' ? 401 : 500;
        res.status(status).json({ error: error.message });
    }
});
