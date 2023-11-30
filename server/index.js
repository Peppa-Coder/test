// server/index.js
const cors = require("cors");
const express = require("express");
const app = express();
const port = 3001;
const http = require("http");
const verifyToken = require("./AuthMiddleware"); // Importa el middleware de autenticación
const { Storage } = require("@google-cloud/storage");
const fileUpload = require("express-fileupload");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const socketIO = require("socket.io");
const {
  createTcpPool,
  insertDriver,
  insertTutor,
  loginTutor,
  listDrivers,
  createRequest,
  deactivateOldSessions,
  createSession,
  saveImageURLToDatabase,
  getTutorDetails,
  listStudents,
  insertStudent,
  checkRutExists,
  deleteTutor,
  getStudentCount,
  deleteStudent,
  checkRutInDrivers,
  checkRutInTutors,
  identifyTutor,
  generateRandomPassword,
  sendTempPasswordEmail,
  updateTemporaryPassword,
  asistStudent,
  noAsistStudent,
  updateStudent,
} = require("./db");

const cookieParser = require("cookie-parser"); // Importa el middleware de cookies para leer las cookies en las solicitudes

const storage = new Storage({
  keyFilename: "./kowapp-20699446fc31.json",
  projectId: "kowapp",
}); // Configuración de Google Cloud Storage
const bucketName = "kowapp"; // Reemplaza con el nombre de tu bucket

app.use(cookieParser()); // Habilita el uso de cookies en las solicitudes

app.use(
  cors({
    origin: "http://localhost:3000", // Permitir solo el origen del cliente
    credentials: true, // Permitir cookies en solicitudes de origen cruzado
  })
);

app.get("/", (req, res) => {
  res.send("¡El servidor está funcionando!");
});

app.listen(port, () => {
  console.log(`Servidor en funcionamiento ${port}`);
});

app.use(express.json()); // Habilita el uso de JSON para las solicitudes POST

app.use(fileUpload()); // Habilita el uso de multipart/form-data para cargar archivos en el servidor

// Crear la conexión cuando la aplicación se inicia.
let db;
const initDatabaseConnection = async () => {
  try {
    db = await createTcpPool();
    console.log("Conexión a la base de datos establecida con éxito.");
  } catch (error) {
    console.error("Error al conectar a la base de datos:", error);
    // Reintentar la conexión o salir de la aplicación según sea necesario
  }
};

initDatabaseConnection();

// Ruta para insertar un nuevo usuario en la tabla "drivers"
app.post("/insert-driver", async (req, res) => {
  try {
    // Recibe los datos del conductor desde la solicitud POST
    const {
      nombre,
      apellido,
      rut,
      email,
      telefono,
      telefonoEmergencia,
      contraseña,
      modeloVehiculo,
      patenteVehiculo,
      capacidadVehiculo,
    } = req.body;

    // Llama a la función insertDriver para insertar al conductor en la base de datos
    const newDriver = await insertDriver(
      nombre,
      apellido,
      rut,
      email,
      telefono,
      telefonoEmergencia,
      contraseña,
      modeloVehiculo,
      patenteVehiculo,
      capacidadVehiculo
    );

    res.json({ message: "Conductor registrado con éxito", newDriver });
  } catch (error) {
    res.status(500).json({
      message: "Error al registrar el conductor",
      error: error.message,
    });
  }
});

app.get("/check-session", (req, res) => {
  try {
    const token = req.cookies.token; // Asume que estás usando cookies para la sesión
    if (!token) {
      return res.status(401).json({ message: "No autenticado" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: "Sesión inválida" });
      }
      return res
        .status(200)
        .json({ message: "Sesión válida", userId: decoded.id });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al verificar la sesión." });
  }
});

// Ruta para autenticar al usuario tutor
app.post("/login", async (req, res) => {
  const { email, contraseña } = req.body;

  try {
    // Verificar si el tutor existe y las credenciales son válidas
    const tutor = await loginTutor(email, contraseña);
    if (tutor) {
      // Desactivar cualquier sesión anterior
      await deactivateOldSessions(tutor.id);

      // Crear una nueva sesión para el tutor y devuelve el token
      const token = await createSession(tutor.id);

      // Establecer el token en una cookie HttpOnly
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax", // Usar 'None' si estás implementando en dominios cruzados con HTTPS
        // secure: process.env.NODE_ENV === 'production', // Descomentar en producción
        maxAge: 3600000, // 1 hora en milisegundos
      });

      // No enviar la contraseña ni información sensible al cliente
      const { password, ...tutorData } = tutor;

      res.status(200).json({ user: tutorData }); // Devuelve los detalles del tutor al cliente
    } else {
      // Manejar el caso de tutor no encontrado o credenciales inválidas
      res.status(401).json({ message: "Credenciales inválidas." });
      console.log(res.message);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al iniciar sesión. Intenta nuevamente." });
  }
});


app.post("/verify-email", async (req, res) => {
  const { email, code } = req.body;

  try {
    // Verifica si el código coincide y aún no ha expirado
    const isValid = await db("verification_codes")
      .where({
        email: email,
        code: code,
      })
      .andWhere("expiry_date", ">", new Date())
      .first();

    if (isValid) {
      // Marca el correo electrónico del usuario como verificado
      await db("tutors")
        .where({ email: email })
        .update({ verificated_email: true });

      res.json({
        success: true,
        message: "Correo electrónico verificado con éxito.",
      });
    } else {
      res.json({ success: false, message: "Código inválido o expirado." });
    }
  } catch (error) {
    console.error("Error al verificar el correo electrónico:", error);
    res.status(500).json({
      success: false,
      message: "Ocurrió un error al verificar el correo electrónico.",
    });
  }
});

app.post("/identify", async (req, res) => {
  const { email } = req.body; // Asumiendo que el cuerpo de la solicitud contiene un campo 'email'

  if (!email) {
    return res.status(400).json({ error: "Debe ingresar un email válido" });
  }

  try {
    // Llama a la función 'identifyTutor' que creará un código de verificación y enviará un correo
    await identifyTutor(email);

    // Si todo es exitoso, devuelve una respuesta adecuada
    res.json({ message: "Código de recuperación enviado correctamente." });
  } catch (error) {
    // Si ocurre un error, envía una respuesta de error
    res.status(500).json({ error: error.message });
  }
});

app.post("/verify-recovery-code", async (req, res) => {
  const { email, code } = req.body;

  try {
    // Verifica si el código coincide y aún no ha expirado
    const isValid = await db("recovery_codes")
      .where({ email: email, code: code })
      .andWhere("expiry_date", ">", new Date())
      .first();

    if (isValid) {
      // Generar contraseña temporal
      const tempPassword = generateRandomPassword(); // Asegúrate de implementar esta función

      // Actualizar contraseña en la base de datos
      await updateTemporaryPassword(email, tempPassword); // Asegúrate de implementar esta función

      // Enviar nueva contraseña al correo del usuario
      await sendTempPasswordEmail(email, tempPassword); // Asegúrate de implementar esta función

      res.json({
        success: true,
        message:
          "Contraseña temporal generada y enviada a tu correo electrónico.",
      });
    } else {
      res
        .status(400)
        .json({
          success: false,
          message: "Código de recuperación inválido o expirado.",
        });
    }
  } catch (error) {
    console.error("Error al verificar el código de recuperación:", error);
    res.status(500).json({
      success: false,
      message: "Ocurrió un error al procesar tu solicitud.",
    });
  }
});

app.post("/logout", verifyToken, (req, res) => {
  const tutor_id = req.userId;

  db("tutors_sessions")
    .where({ tutor_id: tutor_id })
    .del()
    .then(() => {
      // Borrar la cookie 'token' y luego enviar la respuesta
      res.cookie("token", "", {
        httpOnly: true,
        expires: new Date(0),
        sameSite: "lax",
        // secure: process.env.NODE_ENV === 'production', // Descomentar en producción
      });
      res.status(200).json({ message: "Sesión cerrada correctamente." });
    })
    .catch((error) => {
      console.error("Error al cerrar la sesión:", error);
      res.status(500).json({ message: "Error al cerrar la sesión." });
    });
});

app.post("/expired-session", (req, res) => {
  const tutor_id = req.userId;

  db("tutors_sessions")
    .where({ tutor_id: tutor_id })
    .del() 
    .then(() => {
      // Borrar la cookie 'token' y luego enviar la respuesta
      res.cookie("token", "", {
        httpOnly: true,
        expires: new Date(0),
        sameSite: "lax",
        // secure: process.env.NODE_ENV === 'production', // Descomentar en producción
      });
      res.status(200).json({ message: "Sesión cerrada correctamente." });
    })
    .catch((error) => {
      console.error("Error al cerrar la sesión:", error);
      res.status(500).json({ message: "Error al cerrar la sesión." });
    });
});


// Usa la misma conexión para múltiples solicitudes
app.post("/insert-tutor", async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      rut,
      email,
      telefono,
      telefonoEmergencia,
      contraseña,
      nombreNino,
      apellidoNino,
      residencia,
      residenciaEmergencia,
      escuela,
    } = req.body;
    const newtutor = await insertTutor(
      nombre,
      apellido,
      rut,
      email,
      telefono,
      telefonoEmergencia,
      contraseña,
      nombreNino,
      apellidoNino,
      residencia,
      residenciaEmergencia,
      escuela,
      db
    ); // Pasa la conexión `db` a la función
    res.json({ message: "Tutor registrado con éxito", newtutor });
  } catch (error) {
    if (error.field) {
      res.status(400).json({
        message: error.message,
        field: "duplicateEmailOrPhone",
        duplicateField: error.field,
      });
    } else {
      res
        .status(500)
        .json({ message: "Error interno del servidor", error: error.message });
    }
  }
});

//app.use(verifyToken);  // Esto hace que el middleware se aplique a todas las rutas que vienen después de esto

// listar conductores
app.get("/list-drivers", verifyToken, async (req, res) => {
  try {
    const drivers = await listDrivers();
    res.json(drivers);
  } catch (error) {
    console.error("Error al listar los conductores:", error);
    res.status(500).send("Error al obtener los conductores");
  }
});

// listar estudiantes
app.get("/list-students", verifyToken, async (req, res) => {
  try {
    const students = await listStudents(req.userId);
    res.json(students);
  } catch (error) {
    console.error("Error al listar los estudiantes:", error);
    res.status(500).send("Error al obtener los estudiantes");
  }
});

// Endpoint para agregar un nuevo estudiante
app.post("/add-student", verifyToken, async (req, res) => {
  try {
    const studentData = req.body;
    const rut = studentData.rut;

    // Verificar si el RUT existe en las tablas 'drivers' y 'tutors'
    const rutExistsInDrivers = await checkRutInDrivers(rut);
    const rutExistsInTutors = await checkRutInTutors(rut);

    if (rutExistsInDrivers || rutExistsInTutors) {
      return res
        .status(400)
        .json({ message: "RUT ya registrado como conductor o tutor." });
    }

    // Continuar con la inserción si el RUT no existe en las otras tablas
    const tutorId = req.userId;
    const newStudentId = await insertStudent(studentData, tutorId);
    res.status(201).json({
      student_id: newStudentId,
      message: "Estudiante agregado con éxito",
    });
  } catch (error) {
    console.error("Error al agregar el estudiante:", error);
    res.status(500).json({ message: "Error al agregar el estudiante" });
  }
});

app.post('/update-student', verifyToken, async (req, res) => {
  try {
    const studentData = req.body;
    const tutorId = req.userId; // ID del tutor obtenido del token JWT

    const updatedStudentId = await updateStudent(studentData, tutorId);
    res.status(200).json({ message: 'Estudiante actualizado con éxito', student_id: updatedStudentId });
  } catch (error) {
    console.error("Error al actualizar el estudiante:", error);
    res.status(500).json({ message: error.message || 'Error al actualizar el estudiante' });
  }
});


app.delete("/delete-student/:studentId", verifyToken, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const tutorId = req.userId; // Asegúrate de que el estudiante pertenece a este tutor

    await deleteStudent(studentId, tutorId);

    res.status(200).json({ message: "Estudiante eliminado con éxito." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al eliminar el estudiante" });
  }
});

app.get("/get-student-count", verifyToken, async (req, res) => {
  try {
    const tutorId = req.userId; // Asume que el ID del tutor se obtiene del token JWT

    const studentCount = await getStudentCount(tutorId);

    res.json({ studentCount });
  } catch (error) {
    console.error("Error al obtener la cantidad de estudiantes:", error);
    res
      .status(500)
      .json({ message: "Error al obtener la cantidad de estudiantes" });
  }
});

app.get("/check-student/:rut", async (req, res) => {
  try {
    const rut = req.params.rut;
    const exists = await checkRutExists(rut);
    console.log("RUT exists:", exists); // Agregar para depuración
    res.json({ exists });
  } catch (error) {
    console.error("Error en la ruta /check-student:", error);
    res.status(500).send("Error en el servidor");
  }
});

// endpoint para crear una solicitud
app.post("/create-request", verifyToken, async (req, res) => {
  try {
    // El tutorId se extrae del token JWT decodificado
    const tutorId = req.userId;
    const { driverId, status, message } = req.body;
    const requestId = await createRequest(tutorId, driverId, status, message);
    res.json({ success: true, requestId: requestId });
  } catch (error) {
    console.error("Error al procesar la solicitud:", error);
    res
      .status(500)
      .json({ success: false, message: "Error al crear la solicitud" });
  }
});

app.get("/screen-tutor", verifyToken, (req, res) => {
  res.json([{ message: "¡Bienvenido Tutor!" }]); // Send data as an array
});

app.get("/tutor-profile", verifyToken, async (req, res) => {
  // req.userId debe ser establecido por el middleware verifyToken después de verificar el token
  const tutorId = req.userId;

  try {
    const tutorDetails = await getTutorDetails(tutorId); // Obtiene los detalles del tutor de la base de datos

    const { password, ...tutorData } = tutorDetails; // No enviar la contraseña al cliente

    res.json(tutorData); // Envía los datos del tutor al cliente
  } catch (error) {
    console.error("Error al obtener el perfil del tutor:", error);
    res
      .status(500)
      .json({ message: "Error al obtener la información del perfil" });
  }
});

// Ruta para cargar imágenes en Google Cloud Storage
app.post("/upload-profile-picture", verifyToken, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res
        .status(400)
        .json({ message: "No se encontró el archivo para cargar." });
    }
    /* El ID del tutor se obtiene desde el middleware verifyToken que se ejecuta antes de esta ruta y establece el ID del tutor 
    en el objeto de solicitud, la cual se puede acceder como req.userId.
    Req sería el objeto de solicitud que se pasa a esta ruta como primer parámetro, que viene desde el cliente */
    const tutorId = req.userId;

    const file = req.files.file;
    const fileName = `tutor-profile-${tutorId}-image`;
    const blob = storage.bucket(bucketName).file(fileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
    });

    blobStream.on("error", (err) => {
      console.error(err);
      res.status(500).json({
        message: "Error al cargar la imagen en Google Cloud Storage",
        error: err.message,
      });
    });

    blobStream.on("finish", async () => {
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;

      try {
        // Llama a la función que guarda la URL pública en tu base de datos
        await saveImageURLToDatabase(tutorId, publicUrl);
        res
          .status(200)
          .json({ message: "Imagen cargada con éxito", imageUrl: publicUrl });
      } catch (dbError) {
        console.error(
          "Error al guardar la URL de la imagen en la base de datos:",
          dbError
        );
        res.status(500).json({
          message: "Error al guardar la URL de la imagen en la base de datos",
          error: dbError.message,
        });
      }
    });

    blobStream.end(req.files.file.data);
  } catch (error) {
    console.error("Error al cargar la imagen:", error);
    res
      .status(500)
      .json({ message: "Error interno del servidor", error: error.message });
  }
});

// Ruta para obtener la URL firmada de la imagen del perfil del tutor
app.get("/get-tutor-profile-picture", verifyToken, async (req, res) => {
  try {
    const tutorId = req.userId; // Obtiene el ID del tutor de algún lugar, como un token JWT
    const fileName = `tutor-profile-${tutorId}-image`; // Asegúrate de que este nombre coincida con el nombre del archivo al cargarlo
    const file = storage.bucket(bucketName).file(fileName);

    // Verifica si el archivo existe en el bucket antes de intentar obtener una URL firmada
    const [exists] = await file.exists();
    if (!exists) {
      return res
        .status(404)
        .json({ message: "La imagen de perfil no existe." });
    }

    // Opciones para la URL firmada
    const options = {
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000, // URL válida por 15 minutos
    };

    // Obtener la URL firmada
    const [url] = await file.getSignedUrl(options);
    res.status(200).json({ imageUrl: url });
  } catch (error) {
    console.error("Error al obtener la URL firmada:", error);
    res
      .status(500)
      .json({ message: "Error interno del servidor", error: error.message });
  }
});

app.delete("/delete-tutor", verifyToken, async (req, res) => {
  try {
    const tutorId = req.userId; // Asumiendo que el ID del tutor está en el token JWT

    await deleteTutor(tutorId); // Llama a la función para eliminar el tutor y sus estudiantes

    // Borrar la cookie 'token' estableciendo su valor a una cadena vacía y su expiración a una fecha pasada
    res.cookie("token", "", {
      httpOnly: true,
      expires: new Date(0), // Fecha pasada para que la cookie expire inmediatamente
      sameSite: "lax",
      // secure: process.env.NODE_ENV === 'production', // Descomentar esta línea en un entorno de producción si estás utilizando HTTPS
    });

    res
      .status(200)
      .json({ message: "Tutor y estudiantes eliminados con éxito." });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Error al eliminar el tutor y sus estudiantes" });
  }
});

// Endpoint para confirmar la asistencia
app.post('/asist/:studentId', verifyToken, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    await asistStudent(studentId);
    res.status(200).send({ message: 'Asistencia confirmada.' });
  } catch (error) {
    res.status(500).send({ message: 'Error al confirmar la asistencia.' });
  }
});

// Endpoint para confirmar la no asistencia
app.post('/no-asist/:studentId', verifyToken, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    await noAsistStudent(studentId);
    res.status(200).send({ message: 'No asistencia confirmada.' });
  } catch (error) {
    res.status(500).send({ message: 'Error al confirmar la no asistencia.' });
  }
});


//<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<SOCKET>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>//
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    transports: ["polling", "websocket"],
  },
  reconnection: false, // Desactiva la reconexión automática
});

server.listen(3002, () => {
  console.log("Server de socket escuchando el 3002");
});
io.on("connection", (socket) => {
 // console.log("Conections..");
  // Verificar el token del usuario y extraer el ID del usuario
  try {
    // Manejar evento de inicio de sesión
    socket.on("login", ({ userId, userName }) => {
      console.log(`Usuario ${userName} ha iniciado sesión con ID ${userId}`);
      // Puedes realizar acciones adicionales relacionadas con el inicio de sesión aquí
      // Emitir el mensaje a todos los clientes excepto al que se ha conectado
      socket.broadcast.emit("usuarioUnido", {userName});
    });

    // Manejar evento de envío de mensaje
    socket.on("mensaje", ({ senderId, message }) => {
      console.log(`Mensaje recibido de ${senderId}: ${message}`);
      // Puedes realizar acciones adicionales relacionadas con el mensaje aquí
      // Por ejemplo, puedes emitir el mensaje a todos los usuarios conectados
      io.emit("mensaje", { senderId, message });
    });

    socket.on("disconnect", () => {
      console.log("Usuario desconectado");
    });
  } catch (error) {
      console.log("Error en el servidor ");
  }
});

//configuro socket io para chatting
/*const io = require("socket.io")(3002, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    
  },
  reconnection: false
});
*/
/*
let connectedUsers = new Map(); // Usar un Map para mantener el seguimiento del usuario y su socket
function limpiarConexiones() {
  console.log("Limpiando conexiones de usuarios...");
  connectedUsers = new Map(); // Reiniciar las conexiones de usuarios
  console.log("Conexiones limpiadas.");
}
limpiarConexiones();
let connectedSockets = 0;
/*io.on("connection", (socket) => {
  connectedSockets++;
  console.log(`Nueva conexión. Total de conexiones: ${connectedSockets}`);
  socket.on("disconnect", () => {
    connectedSockets--;
    console.log(`Desconexión. Total de conexiones: ${connectedSockets}`);
  });
});

io.on("connection", (socket) => {
  console.log("Tutor conectando...");
  connectedSockets++;
  console.log(`Nueva conexión. Total de conexiones: ${connectedSockets}`);
  //Evento en que el usuario se conecta al socket
  socket.on("login", (tutorId) => {
    connectedUsers.set(tutorId); // Asociar el ID de usuario con el socket Y su tipo(Tutor o conductor)
    //if (userType === "conductor") {
    //  //la sala del conductor, por ejemplo su ID, podría ser la sala en sí
    //  socket.join(userId);
    //} else if (userType === "tutor") {
    //obten el ID del conductor asociado a el tutor ()
    //const conductorId = getConductorId(userId);
    //socket.join(conductorId);
  });
  const date = new Date();
  const currentTime = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
});

io.on("disconnect", () => {
  connectedUsers.forEach((userSocket, user) => {
    if (userSocket === socket) {
      connectedUsers.delete(user);
      const date = new Date();
      const currentTime = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
      console.log(`Usuario ${user} desconectado a las ${currentTime}`);
    }
  });
});

//console.log("Servidor iniciado y listo para nuevas conexiones..");

// Asegurarte de cerrar la conexión cuando la aplicación se cierra
process.on("exit", () => {
  if (db) {
    db.destroy();
    console.log("Conexión a la base de datos cerrada.");
  }
});
*/
