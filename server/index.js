// index.js

const express = require('express');
const app = express();
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getSecrets } = require('./secrets'); // Importa la función getSecrets desde el mismo directorio
const { createTcpPool, registerUser, loginUser } = require('./db.js');

(async () => {
    const secrets = await getSecrets([
        'projects/116591088112/secrets/db_user',
    ]);

app.use(cors(
    {
        origin: 'https://a2ef-2803-c180-2002-b56e-84a5-7d2a-6b78-51d9.ngrok-free.app',
        credentials: true,
    }

));

app.use(express.json());

// Crear la conexión a la base de datos al iniciar la aplicación
createTcpPool().then(() => {
  // Iniciar el servidor solo si la conexión a la base de datos es exitosa
    app.listen(3001, () => {
    console.log('Aplicación escuchando en el puerto 3001!');
    });
}).catch((error) => {
    console.error('Error al conectar a la base de datos:', error);
  // Aquí podrías decidir cerrar la aplicación o reintentar la conexión
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
        const token = jwt.sign({ userId }, secrets['projects/116591088112/secrets/db_user'], {
            expiresIn: '1d',
        });

        // Configura la cookie en la respuesta
        res.cookie('token', token, {
            httpOnly: true, // La cookie solo es accesible por el servidor
            secure: process.env.NODE_ENV !== 'development', // En producción, envía la cookie solo a través de HTTPS
            sameSite: 'strict', // La cookie se envía solo para el mismo sitio
            maxAge: 24 * 60 * 60 * 1000, // Duración de la cookie en milisegundos (1 día en este caso)
        });

        res.json({
            message: 'Inicio de sesión exitoso',
            userId: userId
            // No envíes el token en el cuerpo de la respuesta, ya que se enviará en la cookie
        });
    } catch (error) {
        console.error(error); // Loguea el error para ver los detalles en la consola del servidor
        const status = error.message === 'Usuario no encontrado.' || error.message === 'Contraseña incorrecta.' ? 401 : 500;
        res.status(status).json({ error: error.message });
    }
});
}
)();