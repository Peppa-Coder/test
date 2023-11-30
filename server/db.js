const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

let pool;

const createTcpPool = async () => {
    try {
        // Configuración para una base de datos local
        const dbConfig = {
            user: process.env.DB_USER, // Reemplaza con tu usuario de PostgreSQL
            password: process.env.DB_PASSWORD, // Reemplaza con tu contraseña de PostgreSQL
            host: 'localhost', // 'localhost' si tu base de datos está en tu máquina local
            port: 5432, // Puerto por defecto de PostgreSQL
            database: process.env.DB_NAME, // Reemplaza con el nombre de tu base de datos
        };

        pool = new Pool(dbConfig);
        const client = await pool.connect();
        console.log('Conexión a la base de datos local exitosa');
        client.release();
    } catch (error) {
        console.error('Error al crear la conexión a la base de datos local:', error);
        throw error;
    }
};

const registerUser = async (nombreUsuario, email, hashedPassword) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'INSERT INTO usuarios (nombre_usuario, email, hash_contrasena) VALUES ($1, $2, $3) RETURNING usuario_id',
            [nombreUsuario, email, hashedPassword]
        );
        return result.rows[0].usuario_id;
    } finally {
        client.release();
    }
};

const loginUser = async (email, password) => {
    const client = await pool.connect();
    try {
        const userResult = await client.query('SELECT usuario_id, hash_contrasena FROM usuarios WHERE email = $1', [email]);
        const user = userResult.rows[0];

        if (!user) {
            throw new Error('Usuario no encontrado.');
        }

        const isValid = await bcrypt.compare(password, user.hash_contrasena);
        
        if (!isValid) {
            throw new Error('Contraseña incorrecta.');
        }
        
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
