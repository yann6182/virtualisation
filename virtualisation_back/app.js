const express = require('express');
const multer = require('multer');
const cors = require('cors');
const AWS = require('aws-sdk');
const { Pool } = require('pg');

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Configuration Multer pour gérer l'upload de fichiers
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Configuration pour utiliser LocalStack S3
AWS.config.update({
 accessKeyId: '0000', // Corrected to string
 secretAccessKey: '0000', // Corrected to string
 endpoint: 'http://172.17.0.3:4566', // URL de LocalStack
 s3ForcePathStyle: true // Nécessaire pour LocalStack
});

// Connexion à la base de données PostgreSQL
const pool = new Pool({
 user: 'postgres',
 host: '172.17.0.2',
 database: 'virtualisation',
 password: 'leomessi',
 port: 5432,
});

pool.connect((err) => {
 if (err) {
    console.error('Erreur de connexion à la base de données:', err);
 } else {
    console.log('Connecté à la base de données PostgreSQL');
 }
});

// Créer une nouvelle instance de service S3
const s3 = new AWS.S3();

// Endpoint pour l'upload de fichier
app.post('/upload', upload.single('file'), (req, res) => {
 const file = req.file;
 const params = {
    Bucket: 'vbucket',
    Key: file.originalname,
    Body: file.buffer,
 };

 s3.upload(params, (err, data) => {
    if (err) {
      console.error("Erreur lors de l'upload du fichier :", err);
      return res.status(500).send('Erreur lors de l\'upload du fichier');
    }
    console.log('Fichier uploadé avec succès:', data.Location);
    res.status(200).send('Fichier uploadé avec succès');
 });
});

app.post('/connexion', (req, res) => {
 const { email, mot_de_passe } = req.body;
 if (!email || !mot_de_passe) {
    return res.status(400).json({ message: 'Veuillez fournir votre email et votre mot de passe.' });
 }

 pool.query('SELECT * FROM utilisateurs WHERE email = $1 AND mot_de_passe = $2', [email, mot_de_passe], (error, results) => {
    if (error) {
      console.error("Erreur lors de l'authentification :", error);
      return res.status(500).json({ message: "Une erreur s'est produite lors de l'authentification." });
    }
    if (results.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }
    res.status(200).json({ message: 'Connexion réussie.' });
 });
});

app.post('/inscription', upload.single('image'), (req, res) => {
 const { nom, email, mot_de_passe } = req.body;
 if (!nom || !email || !mot_de_passe || !req.file) {
    return res.status(400).json({ message: 'Veuillez fournir toutes les informations nécessaires.' });
 }

 const image = req.file;
 const params = {
    Bucket: 'vbucket',
    Key: image.originalname,
    Body: image.buffer,
 };

 s3.upload(params, (err, data) => {
    if (err) {
      console.error("Erreur lors de l'upload de l'image :", err);
      return res.status(500).json({ message: "Une erreur s'est produite lors de l'upload de l'image." });
    }

    // Insert user data into the database with the S3 image URL
    pool.query('INSERT INTO utilisateurs (nom, email, mot_de_passe, image) VALUES ($1, $2, $3, $4)', [nom, email, mot_de_passe, data.Location], (error, results) => {
      if (error) {
        console.error("Erreur lors de l'inscription :", error);
        return res.status(500).json({ message: "Une erreur s'est produite lors de l'inscription." });
      }
      console.log('Utilisateur inscrit avec succès.');
      res.status(201).json({ message: 'Inscription réussie.' });
    });
 });
});

app.post('/forgot-password', (req, res) => {
   const { email } = req.body;
   if (!email) {
       return res.status(400).json({ message: 'Veuillez fournir votre adresse e-mail.' });
   }

   // Vérifiez si l'e-mail existe dans la base de données
   pool.query('SELECT * FROM utilisateurs WHERE email = $1', [email], (error, results) => {
       if (error) {
           console.error("Erreur lors de la vérification de l'e-mail :", error);
           return res.status(500).json({ message: "Une erreur s'est produite lors de la vérification de l'e-mail." });
       }
       if (results.rows.length === 0) {
           return res.status(404).json({ message: "Aucun utilisateur trouvé avec cet e-mail." });
       }

       // Générez un token unique pour la réinitialisation de mot de passe et enregistrez-le dans la base de données
       const token = generateUniqueToken(); 
       
       
       // Remplacez cette fonction par votre propre méthode de génération de token
       pool.query('UPDATE utilisateurs SET reset_token = $1 WHERE email = $2', [token, email], (updateError, updateResults) => {
           if (updateError) {
               console.error("Erreur lors de la mise à jour du token de réinitialisation :", updateError);
               return res.status(500).json({ message: "Une erreur s'est produite lors de la mise à jour du token de réinitialisation." });
           }

           // Envoyez un e-mail à l'utilisateur avec un lien contenant le token
           sendResetPasswordEmail(email, token); // Remplacez cette fonction par votre propre méthode d'envoi d'e-mail

           res.status(200).json({ message: "Un e-mail de réinitialisation de mot de passe a été envoyé." });
       });
   });
});


app.post('/reset-password', (req, res) => {
   const { token, newPassword } = req.body;
   if (!token || !newPassword) {
       return res.status(400).json({ message: 'Veuillez fournir un token de réinitialisation et un nouveau mot de passe.' });
   }

   // Vérifiez si le token est valide et n'a pas expiré
   pool.query('SELECT * FROM utilisateurs WHERE reset_token = $1', [token], (error, results) => {
       if (error) {
           console.error("Erreur lors de la vérification du token de réinitialisation :", error);
           return res.status(500).json({ message: "Une erreur s'est produite lors de la vérification du token de réinitialisation." });
       }
       if (results.rows.length === 0) {
           return res.status(404).json({ message: "Token de réinitialisation invalide ou expiré." });
       }

       // Mettez à jour le mot de passe de l'utilisateur dans la base de données
       const email = results.rows[0].email;
       pool.query('UPDATE utilisateurs SET mot_de_passe = $1, reset_token = NULL WHERE email = $2', [newPassword, email], (updateError, updateResults) => {
           if (updateError) {
               console.error("Erreur lors de la réinitialisation du mot de passe :", updateError);
               return res.status(500).json({ message: "Une erreur s'est produite lors de la réinitialisation du mot de passe." });
           }
           res.status(200).json({ message: "Le mot de passe a été réinitialisé avec succès." });
       });
   });
});

function generateUniqueToken() {
   // Générez un token aléatoire avec une longueur spécifique
   const tokenLength = 16;
   const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   let token = '';
   for (let i = 0; i < tokenLength; i++) {
       token += characters.charAt(Math.floor(Math.random() * characters.length));
   }
   return token;
}


function sendResetPasswordEmail(email, token) {
   
   const nodemailer = require('nodemailer');

   // Créez un transporteur SMTP
  // Créez un transporteur SMTP pour Gmail
const transporter = nodemailer.createTransport({
   service: 'gmail',
   auth: {
       user: 'ngaleudiouf@gmail.com',
       pass: 'wfbo wbaj bsxb fzhp'
   }
});


   // Contenu de l'e-mail
   const mailOptions = {
       from: 'ngaleudiouf@gmail.com',
       to: email,
       subject: 'Réinitialisation de mot de passe',
       text: `Bonjour,\n\nVous avez demandé une réinitialisation de mot de passe. Veuillez utiliser le lien suivant pour réinitialiser votre mot de passe : http://localhost:8080/reset-password/${token}\n\nSi vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet e-mail.\n\nCordialement,\nVotre équipe de support`

   };

   // Envoyer l'e-mail
   transporter.sendMail(mailOptions, (error, info) => {
       if (error) {
           console.error("Erreur lors de l'envoi de l'e-mail de réinitialisation de mot de passe :", error);
       } else {
           console.log('E-mail de réinitialisation de mot de passe envoyé :', info.response);
       }
   });
}




app.listen(port, () => {
 console.log(`Serveur démarré sur le port ${port}`);
});
