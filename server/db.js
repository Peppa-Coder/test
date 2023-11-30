const { Pool } = require('pg');
const fs = require('fs');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');

dotenv.config();

let pool;

const createTcpPool = async () => {
    try {
    // Configuración de la base de datos
    const dbConfig = {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
    };

    // Si se especifica una ruta para el certificado de CA, utiliza SSL
    if (process.env.DB_ROOT_CERT) {
        dbConfig.ssl = {
        rejectUnauthorized: false,
        ca: process.env.DB_ROOT_CERT,
        key: process.env.CLIENT_KEY,
        cert: process.env.CLIENT_CERT,
        };
    }

    // Crear el pool de conexiones
    pool = new Pool(dbConfig);

    // Probar la conexión
    const client = await pool.connect();
    console.log('Conexión a la base de datos exitosa');
    client.release();

    } catch (error) {
    console.error('Error al crear la conexión a la base de datos:', error);
    throw error;
    }
};

// Función para registrar un nuevo usuario
const registerUser = async (nombreUsuario, email, hashedPassword) => {
    const client = await pool.connect();
    try {
    const result = await client.query(
        'INSERT INTO usuarios (nombre_usuario, email, hash_contrasena) VALUES ($1, $2, $3) RETURNING usuario_id',
        [nombreUsuario, email, hashedPassword]
    );
    return result.rows[0].usuario_id; // Retorna el ID del usuario registrado
    } finally {
    client.release(); // Asegúrate de liberar el cliente antes de lanzar cualquier error
    }
};

// Función para verificar las credenciales del usuario durante el login
const loginUser = async (email, password) => {
    const client = await pool.connect();
    try {
      // Busca al usuario por email
        const userResult = await client.query('SELECT usuario_id, hash_contrasena FROM usuarios WHERE email = $1', [email]);
        const user = userResult.rows[0];

        if (!user) {
        throw new Error('Usuario no encontrado.');
        }
        
        // Compara la contraseña proporcionada con la hasheada en la base de datos
        const isValid = await bcrypt.compare(password, user.hash_contrasena);
        
        if (!isValid) {
        throw new Error('Contraseña incorrecta.');
        }
        
        // Retorna el ID del usuario si la contraseña es correcta
        return user.usuario_id;
    } finally {
        client.release();
    }
    };

module.exports = {
    createTcpPool,
    registerUser,
    loginUser
};
