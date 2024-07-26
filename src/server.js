const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const path = require("path");
const fs = require("fs");
const hbs = require("hbs");
const collection = require("./mongodb");

const app = express();
const mongoURI = "mongodb://localhost:27017/logsignupDB";

const conn = mongoose.createConnection(mongoURI);
let gfs;

conn.once("open", () => {
    gfs = new GridFSBucket(conn.db, {
        bucketName: "uploads"
    });
});

app.use(express.json());
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, '../views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// Multer configuration for multiple files
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { files: 10 } });

app.get("/", (req, res) => {
    res.render("home");
});

app.get('/imagePage', (req, res) => {
    res.render('imagePage', { title: 'Image Upload' });
});

// Image upload route (modified to handle multiple files)
app.post('/upload', upload.array('image', 10), async (req, res) => {
    if (!req.files) {
        return res.status(400).send('No files uploaded.');
    }

    console.log(req.files); // Log the uploaded files array

    // Define the path where the images will be stored
    const imagePath = path.join(__dirname, '../uploads');

    // Use fs to write the files to the local uploads folder
    req.files.forEach(file => {
        fs.writeFile(path.join(imagePath, file.originalname), file.buffer, async (err) => {
            if (err) {
                return res.status(500).send('Error saving the file.');
            }

            // Store the image in GridFS
            const uploadStream = gfs.openUploadStream(file.originalname);
            uploadStream.end(file.buffer);

            uploadStream.on('finish', async () => {
                // Access the file ID after the upload is complete
                console.log(`File written to GridFS with ID: ${uploadStream.id}`);

                // Store image metadata in the database
                const imageData = {
                    filename: file.originalname,
                    uploadDate: new Date(),
                    path: path.join(imagePath, file.originalname),
                    gridFSId: uploadStream.id
                };

                await collection.updateOne(
                    { name: req.body.name },
                    { $push: { images: imageData } }
                );
            });

            uploadStream.on('error', (error) => {
                console.error('Error writing to GridFS:', error);
                res.status(500).send('Error saving to GridFS.');
            });
        });
    });

    res.send('Files uploaded successfully.');
});

app.get('/images/:filename', (req, res) => {
    const filePath = path.join(__dirname, '../uploads', req.params.filename);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).send('File not found.');
        }
    });
});

app.get('/gridfs/:id', (req, res) => {
    gfs.find({ _id: mongoose.Types.ObjectId(req.params.id) }).toArray((err, files) => {
        if (!files || files.length === 0) {
            return res.status(404).send('File not found.');
        }

        const readStream = gfs.openDownloadStream(files[0]._id);
        readStream.pipe(res);
    });
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.post("/login", async (req, res) => {
    try {
        const check = await collection.findOne({ name: req.body.name });
        if (check && check.password === req.body.password) {
            res.render("home");
        } else {
            res.send("Wrong password");
        }
    } catch {
        res.send("Wrong details");
    }
});

app.get("/signup", (req, res) => {
    const num1 = Math.floor(Math.random() * 10);
    const num2 = Math.floor(Math.random() * 10);
    res.render("signup", { num1, num2 });
});

app.post("/signup", async (req, res) => {
    const { name, password, num1, num2, captcha } = req.body;

    if (parseInt(captcha) !== (parseInt(num1) + parseInt(num2))) {
        return res.send("Captcha validation failed. Please go back and try again.");
    }

    const data = {
        name: name,
        password: password,
        images: [] // Initialize images array
    };

    await collection.insertMany([data]);
    res.render("home");
});

app.get("/forgot-password", (req, res) => {
    res.render("forgot-password");
});

app.post("/forgot-password", async (req, res) => {
    const user = await collection.findOne({ name: req.body.name });
    if (!user) {
        return res.send("User not found");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    user.otp = otp;
    user.otpExpiration = Date.now() + 3600000;
    await user.save();

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'digital.adityadakua@gmail.com',
            pass: 'euoi mybv vmqi ceep'
        }
    });

    const mailOptions = {
        from: 'digital.adtiyadakua@gmail.com',
        to: user.name,
        subject: 'Password Reset OTP',
        text: `Your OTP for password reset is ${otp}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.send("Error sending email");
        } else {
            res.render("otp-verification", { name: req.body.name });
        }
    });
});

app.post("/verify-otp", async (req, res) => {
    const user = await collection.findOne({ name: req.body.name });
    if (!user || user.otp !== parseInt(req.body.otp)) {
        return res.send("Invalid or expired OTP");
    }

    res.render("reset-password", { name: req.body.name });
});

app.post("/reset-password", async (req, res) => {
    const user = await collection.findOne({ name: req.body.name });
    user.password = req.body.password;
    user.otp = undefined;
    await user.save();

    res.render("home");
});

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});