#!/bin/env node


global.PWD = process.env.PWD;
global.ENV = process.env.NODE_ENV || 'development';
global._ = require('lodash');

module.paths.unshift(PWD + '/node_modules');
module.paths.unshift(PWD + '/modules');

var p = require('path');
var fs = require('fs');
var crypto = require('crypto');


var chalk = require('chalk');
var MongoClient = require('mongodb').MongoClient;

// NOTE prompt uses colors, not chalk
var prompt = require('prompt');

prompt.message = "[" + chalk.yellow("?") + "]";

var bounPrefix = '[' + chalk.yellow('BOUN') + '] ';
var successPrefix = '[' + chalk.green('SUCCESS') + '] ';
var errorPrefix = '[' + chalk.red('ERROR') + '] ';

function _writePackage(pkg) {
	fs.writeFileSync(p.join(PWD, 'package.json'), JSON.stringify(pkg, null, '  ') + '\n');
}

var SALT_LENGTH = 16;

function _hash(password) {
	// generate salt
	password = password.trim();
	var chars = '0123456789abcdefghijklmnopqurstuvwxyz';
	var salt = '';
	for (var i = 0; i < SALT_LENGTH; i++) {
		var j = Math.floor(Math.random() * chars.length);
		salt += chars[j];
	}

	// hash the password
	var passwordHash = crypto.createHash('sha512').update(salt + password).digest('hex');

	// entangle the hashed password with the salt and save to the model
	return _entangle(passwordHash, salt, password.length);
}

function _entangle(string, salt, t) {
	string = salt + string;
	var length = string.length;

	var arr = string.split('');
	for(var i = 0; i < salt.length; i++) {
		var num = ((i + 1) * t) % length;
		var tmp = arr[i];
		arr[i] = arr[num];
		arr[num] = tmp;
	}

	return arr.join('');
}

function _mongo(collection, cb) {
	var mongoConfig = require(p.join(PWD, 'server/config/mongo'));

	MongoClient.connect(mongoConfig.uri, function(err, db) {
		if(err) {
			console.error(errorPrefix);
			console.error(err);
			process.exit(1);
		}
		cb(db.collection(collection), db);
	});
}

function createUser(email, password, roles) {
	if(!email || !password) {
		console.log("Usage: boun create-user [email] [password] [?roles]");
		process.exit(1);
	}


	var user = {
		email: email,
		local: {
			password: _hash(password)
		},
		roles: roles ? roles.split(',') : [ 'admin' ],
		isVerified: true,
		dateCreated: new Date()
	};

	_mongo('users', function(users, db) {
		users.insert(user, function(err, user) {
			db.close();
			if(err) {
				console.error(errorPrefix);
				console.error(err);
				process.exit(1);
			} else {
				console.log(successPrefix + "Saved user: " + user.ops[0].email);
				process.exit(0);
			}
		});
	});
}

function createRoles(roles) {

	roleNames = (roles ? roles.split(',') : [ 'user', 'admin' ]);

	_mongo('roles', function(roles, db) {
		roles.insert(roleNames.map(function(role) { return { name: role }; }), function(err) {
			db.close();
			if(err) {
				console.error(errorPrefix);
				console.error(err);
				process.exit(1);
			} else {
				console.log(successPrefix + "Created roles: " + roleNames.join(', '));
				process.exit(0);
			}
		});
	});
}

function changePassword(email, password) {
	if(!email || !password) {
		console.log("Usage: boun change-password [email] [password]");
		process.exit(1);
	}


	_mongo('users', function(users, db) {
		users.update({
			email: email,
		}, {
			$set: {
				'local.password': _hash(password),
				dateModified: new Date()
			}
		}, function(err, user) {
			db.close();
			if(err) {
				console.error(errorPrefix);
				console.error(err);
				process.exit(1);
			} else if(user.result.n < 1) {
				console.error(errorPrefix + 'No user with that email');
				process.exit(1);
			} else {
				console.log(successPrefix + "Password changed for " + email);
				process.exit(0);
			}
		});
	});
}


function createOrganization() {
	_mongo('organizations', function(orgs, db) {
		orgs.insert({ dateCreated: new Date() }, function(err, org) {
			if(err) {
				console.error(errorPrefix);
				console.error(err);
				process.exit(1);
			} else {
				console.log(successPrefix + "Empty organization created");
				process.exit(0);
			}

		});
	});
}

function setup() {
	var childProcess = require('child_process');
	var spawn = childProcess.spawn;
	var exec = childProcess.exec;

	console.log(bounPrefix + 'Copying files from ' + chalk.cyan('boun/files'));
	exec('cp -vr ' + p.normalize(p.join(__dirname, '../files/{.[!.],}*')) + ' ' + PWD + '/', function(error, stdout, stderr) {
																																											 
		if (error !== null) {
			console.log(errorPrefix + 'exec error: ' + error);
			console.log(errorPrefix + 'stderr: ' + stderr);
			process.exit(1);
		}

		console.log(stdout.trim().replace(/‘([^’]*)’/g, chalk.magenta("$1")).replace(/->/g, 'copied to').replace(/^|\n/g, "$&" + bounPrefix));

		console.log(successPrefix + 'All files copied successfully.');

		//var pkg = {
		//	"name": "change-this-fool",
		//	"version": "0.0.0",
		//	"description": "",
		//	"main": "./server/server.js",
		//	"scripts": {
		//		"test": "echo \"Error: no test specified\" && exit 1"
		//	},
		//	"author": "The Code Bureau <info@thecodebureau.com> (https://thecodebureau.com)",
		//	"dependencies": {
		//		"epiphany": "github:thecodebureau/epiphany",
		//		"hats": "github:thecodebureau/hats",
		//		"ridge": "github:thecodebureau/ridge#devel",
		//		"sprinkles": "github:thecodebureau/sprinkles",
		//		"spysass": "github:thecodebureau/spysass"
		//	}
		//};

		//_writePackage(pkg);

		//console.log(successPrefix + chalk.magenta('package.json') + ' written.');

		var git = spawn('git', [ 'init' ], { stdio: 'inherit' });

		git.on('close', function() {
			console.log(successPrefix + 'Git repository initialized.');
		});

	});

}

function dependencies() {
	var modulesFile = p.join(PWD, 'server/modules.js');
	var modules;
	if(fs.existsSync(modulesFile)) {
		modules = require(p.join(PWD, 'server/modules.js'));
		var appPkg = require(p.join(PWD, 'package.json'));

		modules.forEach(function(module) {
			var pkgFile = p.join(/\.\//.test(module) ? PWD : '', module, 'package.json');

			try {
				var pkg = require(pkgFile);

				console.log(bounPrefix + 'Adding dependencies from ' + chalk.green(module));
				console.log(_.pairs(pkg.dependencies).map(function(arr) {
					return '- ' + arr[0] + '@' + arr[1];
				}).join('\n'));

				_.extend(appPkg.dependencies, pkg.dependencies);
			} catch(e) {
				console.log(bounPrefix + 'No package.json found for ' + module);
			}
		});
		_writePackage(appPkg);

		console.log(successPrefix + 'Collected dependencies written to package.json.');
	}

	if(!modules || modules.length === 0) {
		console.log(bounPrefix + 'No modules found.');
	}
}

function templates(argv) {
	//var localDir = require(p.join(PWD, 'server/config/dir.js')).src.templates;

	var modulesFile = p.join(PWD, 'server/modules.js');

	var dirs = [];
	if(fs.existsSync(modulesFile)) {
		var modules = require(modulesFile);

		modules.forEach(function(module) {
			try {
				var paths = require(module + '/paths');
				if(paths.templates)
					dirs.push(paths.templates);
				else
					console.log(bounPrefix + 'No template path for ' + module);
			} catch(e) {
				console.log(bounPrefix + 'No module found for \'' + module + '\' or it does not have a paths file.');
				return;
			}
		});
	}
	var gulpConfigPath = p.join(PWD, 'gulpconfig.js');
	var gulpConfig;

	dirs.unshift(p.join(PWD, 'node_modules/epiphany/templates'));

	if(fs.existsSync(gulpConfigPath))
		gulpConfig = require(gulpConfigPath);
	else
		gulpConfig = {};

	gulpConfig.dust = gulpConfig.dust || {};

	console.log(PWD);
	gulpConfig.dust.src = dirs.map(function(dir) { return p.join(dir, '**/*.dust'); });
	fs.writeFileSync(gulpConfigPath, ('module.exports = ' + JSON.stringify(gulpConfig, null, '\t') + ';').replace(new RegExp('"' + PWD, 'g'), 'PWD + "'));
}

function config(argv) {
	var dirs = [ p.join(PWD, 'node_modules/epiphany/config') ];

	var modulesFile = p.join(PWD, 'server/modules.js');

	if(fs.existsSync(modulesFile)) {
		var modules = require(modulesFile);
		var appPkg = require(p.join(PWD, 'package.json'));

		modules.forEach(function(module) {
			var modulePath = p.join(PWD, /\.\//.test(module) ? '' : 'node_modules', module);
			var configPath = p.join(modulePath, 'config');
			if(fs.existsSync(configPath))
				dirs.push(configPath);

			configPath = p.join(modulePath, 'server', 'config');

			if(fs.existsSync(configPath))
				dirs.push(configPath);
		});
	}

	var dest = p.join(PWD, 'server', 'config');

	var dontOverwrite = !!argv[0] || argv[0] === '-n'; 

	prompt.start();

	recurse(dirs);

	// this shit is all done because prompt is always asynchronous. if
	// this stupid gay ass code isn't used, the script will continue
	// instead of waiting for the previous prompt to be answered.
	function recurse(paths, i, root, parentNext) {
		i = i || 0;

		var path = paths[i];

		root = root || path;

		var next = recurse.bind(null, paths, ++i, paths === dirs ? null : root, parentNext);

		if(!path) {
			if(parentNext)
				return parentNext();

			return;
		}
		
		if(!fs.existsSync(path)) {
			return parentNext ? parentNext() : next();
		}

		if(fs.statSync(path).isDirectory()) {
			var files = fs.readdirSync(path).map(function(file) {
				return p.join(path, file);
			});

			recurse(files, 0, root, next);
		} else {
			var questions = [];
			var target = (p.join(dest, p.relative(root, path)));
			var targetRelative = './' + p.relative(PWD, target);
			var pathRelative = './' + p.relative(PWD, path);

			var exists;
			if((exists = fs.existsSync(target))) {
				if(!dontOverwrite)
					questions.push({
						name: 'yesno',
						message: chalk.white('Overwrite ' + chalk.yellow(targetRelative)	+ ' with ' + chalk.yellow(pathRelative) + '?'),
						validator: /y[es]*|n[o]?/,
						warning: 'Must respond yes or no',
						default: 'no'
					});
			} else {
				var parentDir = p.dirname(target);

				while(!fs.existsSync(parentDir)) {
					fs.mkdirSync(parentDir);
					parentDir = p.dirname(parentDir);
				}
			}

			prompt.get(questions, function(err, result) {
				if(err) process.exit(0);

				if(!exists || result.yesno === 'y') {
					console.log(chalk.magenta(pathRelative) + ' > ' + chalk.magenta(targetRelative));
					fs.createReadStream(path).pipe(fs.createWriteStream(target));
				}

				next();
			});

		}
	}
}

var argv = process.argv.slice(2);

switch(argv[0]) {
	case 'config':
		return config.call(null, argv.slice(1));
	case 'create-user':
		return createUser.apply(null, argv.slice(1));
	case 'create-roles':
		return createRoles.apply(null, argv.slice(1));
	case 'change-password':
		return changePassword.apply(null, argv.slice(1));
	case 'create-organization':
		return createOrganization.apply(null, argv.slice(1));
	case 'deps':
	case 'dependencies':
		return dependencies.apply(null, argv.slice(1));
	case 'templates':
		return templates.call(null, argv.slice(1));
	case 'setup':
		return setup.apply(null, argv.slice(1));
}

console.log("Usage: boun help");
