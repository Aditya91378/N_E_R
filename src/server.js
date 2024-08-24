const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const path = require("path");
const fs = require("fs");
const hbs = require("hbs");
const collection = require("./mongodb");
const { exec } = require('child_process'); // Import child_process
const csv = require('csv-parser');

require('dotenv').config();
const app = express();
const mongoURI = process.env.MONGO_URI;
const csvFile = process.env.CSV_FILE;
const pythonPath=process.env.PYTHON_PATH;

// Create MongoDB connection
const conn = mongoose.createConnection(mongoURI);
let gfs;

conn.once("open", () => {
    gfs = new GridFSBucket(conn.db, {
        bucketName: "uploads"
    });
});

// Middleware
app.use(express.json());
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, '../views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
// Serve static files from the "uploads" directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads'))); // Path to uploads directory
// Multer configuration for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { files: 10 } });

app.get("/index", (req, res) => {
    res.render("index.html")
    })

// Home route 
app.get("/", (req, res) => {
    res.render("home");
});

// Image upload page route
app.get('/imagePage', (req, res) => {
    res.render('imagePage', { title: 'Image Upload' });
});

// Define the path where the images will be stored
const imagePath = path.join(__dirname, '../uploads');

// Image upload route (modified to handle multiple files)
app.post('/upload', upload.array('image', 10), async (req, res, next) => {
    if (!req.files) {
      return res.status(400).send('No files uploaded.');
    }
  
    try {
      console.log(req.files); // Log the uploaded files array
  
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
  
      // Render the same page with a success message
      res.render('imagePage', { title: 'Image Upload', successMessage: 'Files uploaded successfully!' });
  
      // Call the function to run the Python script
      runPythonScript();
    } catch (err) {
      next(err); // Pass the error to the error handling middleware
    }
  });
  
  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Internal Server Error');
  });


// Function to convert headers to Handlebars-friendly format
const makeHeaderFriendly = (header) => {
    return header.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
};


// Route to render the combined view
app.get('/upload', (req, res) => {
    const results = [];
    let headers = [];

    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('headers', (headerList) => {
            headers = headerList.map(makeHeaderFriendly);
        })
        .on('data', (data) => {
            // Convert keys of each row to Handlebars-friendly format
            const friendlyData = {};
            for (const key in data) {
                friendlyData[makeHeaderFriendly(key)] = data[key];
            }
            results.push(friendlyData);
        })
        .on('end', () => {
            // After reading the CSV file, process the data
            results.forEach(row => {
              // Check if row.Image exists before calling replace()
              if (row.Image) {
                row.imageFilename = row.Image.replace(/\\/g, '/');
              } else {
                row.imageFilename = ''; // Set a default value if row.Image is undefined
              }
            });

            // Render the view, passing the headers and rows
            res.render('upload', { headers, rows: results });
        });
});

// Route to retrieve images from GridFS
app.get('/gridfs/:id', (req, res) => {
    gfs.find({ _id: mongoose.Types.ObjectId(req.params.id) }).toArray((err, files) => {
        if (!files || files.length === 0) {
            return res.status(404).send('File not found.');
        }

        const readStream = gfs.openDownloadStream(files[0]._id);
        readStream.pipe(res);
    });
});

// Login route
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

// Signup route
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

// Forgot password route
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
            user: process.env.SMTP_USER,
            pass:  process.env.SMTP_PASS
        }
    });

    const mailOptions = {
        from: process.env.SMTP_USER,
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

// OTP verification route
app.post("/verify-otp", async (req, res) => {
    const user = await collection.findOne({ name: req.body.name });
    if (!user || user.otp !== parseInt(req.body.otp)) {
        return res.send("Invalid or expired OTP");
    }

    res.render("reset-password", { name: req.body.name });
});

// Reset password route
app.post("/reset-password", async (req, res) => {
    const user = await collection.findOne({ name: req.body.name });
    user.password = req.body.password;
    user.otp = undefined;
    await user.save();
    
    res.render("home");
});

// Run the Python script when the server starts
const runPythonScript=()=>{
    exec(`python "${pythonPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing Python script: ${error}`);
            return;
        }
        console.log(`Python script output: ${stdout}`);
        console.error(`Python script stderr: ${stderr}`);
    });
};


// Start the server
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});
