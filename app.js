var express = require('express');
var bodyParser = require("body-parser");
var handlebars = require("express-handlebars").create({
    defaultLayout: "main"
});
var app = express();
var aws = require("aws-sdk");
var fs = require("fs");
var dotenv = require('dotenv').config();
var crypto = require("crypto");
var path = require("path");
var fileUpload = require("express-fileupload");
var { v4: uuidv4 } = require('uuid');
var algorithm = "sha256";
var validatePassword = (password, hash) => {
    if (crypto.createHash(algorithm).update(password).digest('hex') == hash)
        return true;
    else
        return false;
}
var cookieParser = require('cookie-parser');

//Middleware
app.engine("handlebars", handlebars.engine);
app.set('view engine', 'handlebars');
app.set('views', './views');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(fileUpload());
app.use(cookieParser())
app.use(express.static('public'));
//AWS services

var accessKeyId = process.env.ACCESSKEYID;
var secretAccessKey = process.env.SECRETACCESSKEY;
var bucketName = process.env.BUCKETNAME;
var IndexId = process.env.INDEXID;

var s3 = new aws.S3({
    region: "us-east-2",
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey
});

var kendra = new aws.Kendra({
    region: "us-east-1",
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
    apiVersion: '2019-02-03'
});

var ddb = new aws.DynamoDB({
    region: "us-east-1",
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey
});

//Get methods
app.get("/", (req, res) => {
    res.redirect("/login");
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/signup", (req, res) => {
    res.render("signup");
});

app.get("/search", (req, res) => {
    res.render("search");
});

app.get("/upload", (req, res) => {
    res.render("upload");
});

app.get("/logout", (req, res) => {
    res.redirect("/login");
});

//Post methods

app.post("/login", (req, res) => {
    var { email, password } = req.body;
    var params = {
        TableName: 'users',
        Key: {
            'email': { S: email }
        }
    };
    ddb.getItem(params, (err, data) => {
        if (err) {
            console.log("Error", err);
        }
        else {
            {
                if (Object.keys(data).length === 0) {
                    res.send("User doesn't exist");
                }
                else {
                    if (validatePassword(password, data.Item.password.S)) {
                        var email = data.Item.email.S;
                        res.cookie('email', email);
                        res.redirect("/search");
                    }
                    else {
                        res.send("Wrong Password!!!");
                    }
                }
            }
        }
    });
});

app.post("/signup", (req, res) => {
    var { name, email, password } = req.body;
    var params = {
        TableName: 'users',
        Key: {
            'email': { S: email }
        }
    };
    ddb.getItem(params, (err, data) => {
        if (err) {
            console.log("Error", err);
        } else {
            console.log("Success", data);
            if (Object.keys(data).length === 0) {
                var params = {
                    TableName: 'users',
                    Item: {
                        'email': { S: email },
                        'name': { S: name },
                        'password': { S: crypto.createHash(algorithm).update(password).digest('hex') }
                    }
                }
                ddb.putItem(params, (err, data) => {
                    if (err) {
                        console.log("Error", err);
                    } else {
                        console.log("Success", data);
                    }
                });
                res.redirect("/login");
            }
            else {
                res.send("User already exists!!!");
            }
        }
    });
});

app.post("/search", (req, res) => {
    var { search } = req.body;
    var params = {
        IndexId: IndexId,
        QueryText: search
    };
    kendra.query(params, function (err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else {
            res.render("results", {
                data: data.ResultItems
            });
        };          // successful response
    });

})

app.post("/upload", (req, res) => {
    var { title } = req.body;
    var fileId = uuidv4();
    const params = {
        Bucket: bucketName,
        Key: `${fileId}.pdf`,
        Body: req.files.file.data
    };
    s3.upload(params, function (err, data) {
        if (err) {
            console.log(err);
        } else {
            var getParams = {
                TableName : "files",
                Key : {
                    "etag" : {S : String(data.ETag).slice(1,-1)},
                    "length" : {S : String(req.files.file.size)}
                }
            }
            ddb.getItem(getParams, (err,ddbData)=>{
                if(err) console.log(err);
                if (Object.keys(ddbData).length === 0){
                    var params = {
                        TableName: 'files',
                        Item: {
                            'fileid': { S: fileId },
                            "email": { S: req.cookies.email},
                            "title": { S: title },
                            "urlLink": { S: `https://s3.us-east-1.amazonaws.com/newbucketcreatedsanjayishanisaudi/${fileId}.pdf`},
                            "etag" : {S : String(data.ETag).slice(1,-1)},
                            "length" : {S : String(req.files.file.size)}
                        }
                    }
                    ddb.putItem(params, (err, data) => {
                        if (err) {
                            console.log("Error", err);
                        } else {
                            console.log("Success", data);
                            res.send("File Uploaded Successfully!!!")
                        }
                    });
                }
                else{
                    const params = {
                        Bucket: bucketName,
                        Key: `${fileId}.pdf`
                    };
                    s3.deleteObject(params, function(err, data) {
                        if (err) console.log(err);  // error
                        else     res.send("File is already uploaded/Plagirism");              // deleted
                      });
                }
            });
        }
    });
});

app.use((req, res) => {
    res.status(404);
    res.render('notfound');
});

app.listen(3000);
