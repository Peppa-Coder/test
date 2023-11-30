// secrets.js

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager').v1;

// Función para obtener secretos de Cloud Secret Manager
async function getSecrets(secretNames) {
    const client = new SecretManagerServiceClient();
    const secrets = {};

    for (const secretName of secretNames) {
    try {
        const [version] = await client.accessSecretVersion({
        name: `${secretName}/versions/latest`,
        });

        if (version.payload.data) {
        // Decodifica el valor del secreto como una cadena UTF-8
        secrets[secretName] = version.payload.data.toString('utf8');
        } else {
        console.error(`El secreto ${secretName} no tiene un valor.`);
        }
    } catch (error) {
        console.error(`Error al obtener el secreto ${secretName}:`, error);
    }
    }

    return secrets;
}

module.exports = { getSecrets };
