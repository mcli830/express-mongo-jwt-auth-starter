const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const _ = require('lodash');
const validator = require('validator');

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        validate: [validator.isEmail, 'Please use a valid email address.'],
    },
    password: {
        type: String,
        required: true,
    },
    sessions: [{
        token: {
            type: String,
            required: true
        },
        expiry: {
            type: Number,
            required: true,
        }
    }]
});

/* MODEL METHODS */

// find instance by id and token
UserSchema.statics.findByIdAndToken = function(_id, refreshToken) {
    const User = this;

    // return promise with user document
    return User.findOne({
        _id,
        'sessions.token': refreshToken, // searches user.sessions[].token
    });
}

// find by credentials for login
UserSchema.statics.findByCredentials = function(email, password) {
    const User = this;

    return User.findOne({ email }).then(user => {
        // no user found
        if (!user) return Promise.reject({ message: 'User does not exist.' });
        // user found => compare passwords
        return new Promise((resolve, reject) => {
            bcrypt.compare(password, user.password, (err, same) => {
                if (err) return reject(err);

                if (same) {
                    // passwords match => success
                    resolve(user);
                } else {
                    // password incorrect
                    reject({ message: 'Password is incorrect.' });
                }
            });
        });
    });
}

UserSchema.statics.hasRefreshTokenExpired = (expiry) => {
    const now = getTimeInSeconds(true);

    // current time has passed expiry time => expired => true
    return now > expiry;
}

/* MIDDLEWARE HOOKS */

// pre-save hook
UserSchema.pre('save', function(next) {
    const user = this;
    const saltRounds = 10; // cost and security level for bcrypt hash

    // if the password field has been edited/changed
    if (user.isModified('password')) {

        // generate salt and hash password
        bcrypt.genSalt(saltRounds, (err, salt) => {
            if (err) return next(err);

            // successful salt => generate hash
            bcrypt.hash(user.password, salt, (err, hash) => {
                if (err) return next(err);
                // update user password with hash
                user.password = hash;
                // continue with save
                return next();
            });
        });
    }
    // no modifications => use next middleware
    return next();
});

/* INSTANCE METHODS */

// overwrite UserSchema's toJSON method to prevent
// sensitive data from being exposed (eg. password)
UserSchema.methods.toJSON = function() {
    const user = this.toObject();
    return _.omit(user, ['password', 'sessions']);
}

// generate token for authentication
UserSchema.methods.generateAccessAuthToken = function() {
    const user = this;

    return new Promise((resolve, reject) => {
        // create and return new JSON web token
        jwt.sign(
            // user payload
            { _id: user._id.toHexString() },
            // secret
            process.env.SECRET,
            // token options
            { expiresIn: "15m" },
            // callback
            (err, token) => {
                if (err) {
                    reject(err);
                } else {
                    // token signed successfully
                    resolve(token);
                }
            }
        );
    });
}

// create new session and save it to user document
UserSchema.methods.createSession = function() {
    const user = this;

    return generateRefreshAuthToken().then(refreshToken => {
        return saveSessionToDatabase(user, refreshToken);
    }).then(refreshToken => {
        // return a promise resolving with refreshToken
        return refreshToken;
    }).catch(err => {
        return Promise.reject(err);
    });
}

/* HELPER METHODS */

// generate token auth refresh token as 64byte hex string
function generateRefreshAuthToken() {
    return new Promise((resolve, reject) => {
        crypto.randomBytes(64, (err, buf) => {
            if (err) {
                reject(err);
            } else {
                // success - convert buffer to token string
                const token = buf.toString('hex');
                resolve(token);
            }
        });
    });
}

// save session with refresh token to database
function saveSessionToDatabase(user, refreshToken) {
    return new Promise((resolve, reject) => {
        let expiry = generateRefreshTokenExpiryTime();

        // add session to user
        user.sessions.push({
            token: refreshToken,
            expiry,
        });

        // save user document
        user.save().then(() => {
            // session saved successfully
            resolve(refreshToken);
        }).catch(err => {
            reject(err);
        });
    });
}

// generate expiry time for refresh tokens
function generateRefreshTokenExpiryTime() {
    let daysUntilExpire = 10;
    let secondsUntilExpire = (daysUntilExpire * 24 * 60) + 60;
    let now = getTimeInSeconds(true);
    return now + secondsUntilExpire;
}

// gets current unix time
function getTimeInSeconds(floor = false) {
    let seconds = Date.now() / 1000; // ms to s
    return floor ? Math.floor(seconds) : seconds;
}

module.exports = mongoose.model('User', UserSchema);
