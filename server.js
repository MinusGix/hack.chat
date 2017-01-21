/* jshint esnext: true */

var fs = require('fs');
var ws = require('ws');
var crypto = require('crypto');

var badProps = [
	'constructor',
	'prototype',
	'proto',
	'__proto__',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
	'hasownproperty',
	'isprototypeof',
	'propertyisenumerable',
	'tolocalestring',
	'tostring',
	'valueof'
];
var emptyVals = [
	undefined,
	null,
	NaN,
	''
];
var tripLength = 6;

function logIt(text) {
	console.log(text);
	fs.appendFileSync(__dirname + '/errorlog.txt', text + '\n');
}
logIt('\n===Server Launching===')

function doesRoomExist(a) {
	a = String(a);
	if (rooms[a] !== undefined && badProps.indexOf(a.toLowerCase()) === -1) {
		return true;
	}
	return false;
}



function replaceStuff(text, client) {
	return text.replace(/\%user(nick|name|nickname)\%/, client.nick)
		.replace(/\%(user|cur(rent|)|)(chan(nel|)|room)\%/, client.channel)
		.replace(/\%(user|)(trip(code|)|pass(word|))\%/, ((client.trip === undefined || isAdmin(client)) ? 'NONE' : client.trip));
}

function loadJSON(filename, name) {
	try {
		var data = fs.readFileSync(filename, 'utf8');
		logIt("Loaded %s '%s'".replace(/\%s/, name).replace(/\%s/, filename));
		return JSON.parse(data);
	} catch (e) {
		console.warn(e);
	}
}

function writeJSON(filename, data, name) {
	try {
		fs.writeFileSync(filename, JSON.stringify(data, undefined, 4)); //tabs it with 4 spaces, could be better :p
		logIt('Wrote %s \'%s\''.replace(/\%s/, name).replace(/\%s/, filename));
		return true;
	} catch (e) {
		console.warn(e);
		return false;
	}
}


var config = {};
var configFilename = 'JSON/config.json';
config = loadJSON(configFilename, 'config');
fs.watchFile(configFilename, {
	persistent: false
}, function () {
	config = loadJSON(configFilename, 'config');
});


var rooms = {};
var roomsFilename = 'JSON/rooms.json';
rooms = loadJSON(roomsFilename, 'rooms');

/*Semi bad idea, considering i might accidently cause a loop of reading/writing
i kinda forgot why i removed it, im typing this a couple minutes after this ^
:(y
fs.watchFile(roomsFilename, {
	persistent: false
}, function () {
	rooms = loadJSON(roomsFilename, 'rooms');
});*/



var server = new ws.Server({
	host: config.host,
	port: config.port
});
logIt("Started server on " + config.host + ":" + config.port);

server.on('connection', function (socket) {
	socket.on('message', function (data) {
		try {
			// Don't penalize yet, but check whether IP is rate-limited
			if (POLICE.frisk(getAddress(socket), 0)) {
				send({
					cmd: 'warn',
					text: "Your IP is being rate-limited or you are banned."
				}, socket);
				return;
			}


			// ignore ridiculously large packets
			if (data.length > 65536) {
				return;
			}


			var args = JSON.parse(data);


			
			var cmd = args.cmd;
			var command = COMMANDS[cmd];
			var c;
			if (!!socket.channel) {
				c = socket.channel;

			} else if (args.cmd === 'join') {
				c = args.channel;
			}
			if (doesRoomExist(c)) { //might work might not, need to test.
				if (rooms[c].banned.indexOf(getAddress(socket)) >= 0) {
					send({
						cmd: 'warn',
						text: 'You are banned from this room.'
					}, socket);
					socket.close();
				}
			}
			if (command && args) {
				//makes so I can make some commands penalize less than others
				if (typeof (command.penalize) === 'number') {
					POLICE.frisk(getAddress(socket), command.penalize);
				} else {
					POLICE.frisk(getAddress(socket), 1);
				}
				command.run(args, socket);
				return;
			}
			//penalizes even if it wasn't a command
			POLICE.frisk(getAddress(socket), 1);
		} catch (e) {
			console.warn(e.stack);
		}
	});

	socket.on('close', function () {
		try {
			COMMANDS.leave.run({}, socket);
		} catch (e) {
			console.warn(e.stack);
		}
	});
});

function send(data, client) {
	// Add timestamp to command
	data.time = Date.now();
	try {
		if (client.readyState == ws.OPEN) {
			client.send(JSON.stringify(data));
		}
	} catch (e) {
		// Ignore exceptions thrown by client.send()
	}
}

/** Sends data to all clients
channel: if not null, restricts broadcast to clients in the channel
*/
function broadcast(data, channel) {
	for (var client of server.clients) {
		if (channel ? client.channel === channel : client.channel) {
			send(data, client);
		}
	}
}

function nicknameValid(nick) {
	// Allow letters, numbers, and underscores
	return /^[a-zA-Z0-9_]{1,24}$/.test(nick);
}

function getAddress(client) {
	if (config.x_forwarded_for) {
		// The remoteAddress is 127.0.0.1 since if all connections
		// originate from a proxy (e.g. nginx).
		// You must write the x-forwarded-for header to determine the
		// client's real IP address.
		return client.upgradeReq.headers['x-forwarded-for'];
	} else {
		return client.upgradeReq.connection.remoteAddress;
	}
}

function hash(password) {
	var sha = crypto.createHash('sha512');
	sha.update(password + config.salt);
	return sha.digest('base64').substr(0, tripLength);
}

function isReqRank(rank, client) {
	if (typeof (rank) !== 'string') return false;
	var r = rank.toLowerCase();
	//TODO modify these to use regex instead(or maybe not?)
	if (r === 'admin' || r === 'siteadmin' || r === 'site-admin' || r === 'globaladmin' || r === 'global-admin') {
		return isAdmin(client);
	} else if (r === 'mod' || r === 'sitemod' || r === 'site-mod' || r === 'globalmod' || r === 'global-mod') {
		return isMod(client);
	} else if (['chanowner', 'channelowner', 'roomowner', 'chan-owner', 'channel-owner', 'room-owner'].indexOf(r) >= 0) {
		return isChanOwner(client);
	} else if (['chanadmin', 'channeladmin', 'roomadmin', 'chan-admin', 'channel-admin', 'room-admin'].indexOf(r) >= 0) {
		return isChanAdmin(client);
	} else if (['chanowner', 'channemod', 'roomod', 'chanmod', 'channelmod', 'roommod'].indexOf(r) >= 0) {
		return isChanMod(client);
	}

	return false;
}

function isAdmin(client) {
	var c = [];
	var d = [];
	config.admins.map(function (a, b) {
		c.push(a[0].toLowerCase());
		d.push(a[1]);
	});
	return c.indexOf(client.nick.toLowerCase()) >= 0;
}

function isMod(client, allowRankAbove) {
	if (isAdmin(client) && !allowRankAbove) return true;
	if (config.mods) {
		if (client.trip && config.mods.indexOf(client.trip) > -1) {
			return true;
		}
	}
	return false;
}

function isChanOwner(client, allowRankAbove) {
	if (!isRoomOwned(client.channel)) return false; //so if the room doesn't exist this doesn't work :3
	if (isMod(client) && !allowRankAbove) return true;

	if (rooms[client.channel].owner === client.trip) return true;
}

function isChanAdmin(client, allowRankAbove) {
	if (!isRoomOwned(client.channel)) return false; //so if the room doesn't exist this doesn't work :3
	if (isChanOwner(client) && !allowRankAbove) return true;

	return rooms[client.channel].admins.indexOf(client.trip) >= 0;
}

function isChanMod(client, allowRankAbove) {
	if (!isRoomOwned(client.channel)) return false; //so if the room doesn't exist this doesn't work :3
	if (isChanAdmin(client) && !allowRankAbove) return true;

	return rooms[client.channel].mods.indexOf(client.trip) >= 0;
}

function isRoomOwned(roomName) {
	return rooms[roomName] !== undefined;
}

function getSetting(channel, name) {
	if (!isRoomOwned(channel)) {
		return config.defaultSettings[name];
	}
	var r = rooms[channel];
	if (r.settings[name] === undefined) {
		return config.defaultSettings[name];
	} else {
		return r.settings[name];
	}
}

String.prototype.capitalize = function () {
	return this[0].toUpperCase() + this.slice(1, this.length);
};

function canThey(t, args, client) {
	if (['broadcast', 'ban', 'kick', 'addmods', 'addadmins', 'removeadmins', 'removemods', 'chat', 'cmdme', 'cmdhelp', 'cmdpromote', 'cmddemote', 'cmdwhisper'].indexOf(t.toLowerCase()) >= 0) {
		var a = false;
		if (isChanOwner(client)) { //This will work also if the user is the site admin, or site mod
			a = true;
		} else if (isChanMod(client, true) && getSetting(client.channel, 'modscan' + t.toLowerCase())) {
			a = true;
		} else if (isChanAdmin(client, true) && getSetting(client.channel, 'adminscan' + t.toLowerCase())) {
			a = true;
		} else if (getSetting(client.channel, 'defaultscan' + t.toLowerCase()) && !isChanMod(client, true) && !isChanAdmin(client, true)) {
			a = true;
		}
		return a;
	}
	return false;
}

function claimRoom(room, client) {
	rooms[room] = {
		owner: client.trip,
		admins: [],
		mods: [],
		banned: [],
		settings: {},
		modules: {}
	};
	writeJSON(roomsFilename, rooms, 'rooms');
	return true;
}


var cmds = {
	help: {
		name: 'help',
		help: 'Usage:\nShow the general help for all commands:\n' + config.commandPrefix + 'help\n\nShow the help for a certain command (Without the <>):\n' + config.commandPrefix + 'help <command name here>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('cmdhelp', args, client);
		},
		use: function (args, client) {
			var toSend = {
				cmd: 'alert',
				text: 'That is not a valid command to get help on, sorry.'
			};
			if (emptyVals.indexOf(args.warl[0]) >= 0) {
				//normal help
				var base = 'Commands:\n==========================\n';
				var t = base;
				var a = Object.keys(cmds);
				for (var i = 0; i < a.length; i++) {
					if (typeof (cmds[a[i]].reqRank) === 'string') {
						if (cmds[a[i]].reqRank === 'custom') {
							if (!cmds[a[i]].check(args, client)) {
								continue;
							}
						} else if (!isReqRank(cmds[a[i]].reqRank, client)) {
							continue;
						}
					}
					if (i !== 0) {
						t += ', ';
					}
					t += config.commandPrefix + a[i];
				}
				if (a.length >= 1) t += '.';

				if (t === base) {
					toSend.text = t + 'Sorry, but there was no commands found.';
				} else {
					toSend.text = t;
				}
			} else if (badProps.indexOf(args.warl[0]) === -1 && cmds[args.warl[0]] !== undefined) {
				//specific help
				toSend.text = ((emptyVals.indexOf(cmds[args.warl[0]].help) >= 0) ? 'Sorry, but there has not been any help added to that command, will hopefully add soon.' : replaceStuff(cmds[args.warl[0]].help, client));
			}

			send(toSend, client);
		}
	},
	me: {
		name: 'me',
		help: 'Usage:\n' + config.commandPrefix + 'me eats pie\nOutputs: %usernick% eats pie',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('cmdme', args, client);
		},
		use: function (args, client) {
			broadcast({
				cmd: 'alert',
				text: client.nick + ' ' + args.war.join(' ')
			}, client.channel);
		}
	},
	tripcode: {
		name: 'tripcode',
		help: 'A tripcode, or also called a trip, is a set of characters(text) that will appear next to your name. This helps other users verify that it is actually you, since anyone can log in with any name, but it would be hard to guess your tripcode pass.\nTo login with a tripcode refresh the page and where it asks for your name type:\n%usernick%#pass\nreplace the "pass" with any (well almost any) amount of characters (excluding "#") and that will be your pass, and it will generate a tripcode. Your tripcode will be the same when you login with that pass. Your tripcode will be the same if you login with that pass and have a different username.',
		use: function (args, client) {
			send({
				cmd: 'alert',
				text: replaceStuff(this.help, client)
			}, client);
		}
	},
	whisper: {
		name: 'whisper',
		help: 'Usage:\n' + config.commandPrefix + 'whisper <person to whisper to name> hello you person!',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('cmdwhisper', args, client);
		},
		use: function (args, client) {
			if (!client.channel) {
				return;
			}
			var nick = args.warl[0];
			if (!nick) {
				send({
					cmd: 'alert',
					text: 'You did not specify who you are inviting, please do.'
				}, client);
				return;
			}
			nick = nick.toLowerCase();
			var friend;
			for (var cli of server.clients) {
				// Find friend's client

				if (cli.channel == client.channel && cli.nick.toLowerCase() == nick) {
					friend = cli;
					break;
				}
			}

			if (!friend) {
				send({
					cmd: 'alert',
					text: "Could not find " + nick + " in channel."
				}, client);
				return;
			}
			if (friend === client) return;

			send({
				cmd: 'notify',
				nick: client.nick,
				text: 'You whispered to ' + nick + ': ' + args.war.slice(1, args.war.length).join(' ')
			}, client);
			send({
				cmd: 'notify',
				nick: client.nick,
				text: client.nick + ' whispered to you: ' + args.war.slice(1, args.war.length).join(' ')
			}, friend);
		}
	},
	claimroom: {
		name: 'claimroom',
		help: 'Usage:\nUse this command in a room that is not owned by anyone else that you want to own:\n' + config.commandPrefix + 'claimroom',
		use: function (args, client) {
			var c = client.channel;
			var d = rooms[c];
			if (!c) {
				send({
					cmd: 'alert',
					text: 'You are not in an actual room.'
				}, client);
				return;
			}
			if (d === undefined) {
				if (!client.trip) {
					send({
						cmd: 'alert',
						text: 'You need a tripcode to claim a room.\nUse \'' + config.commandPrefix + 'tripcode\' to learn how to acquire a tripcode.'
					}, client);
				} else {
					if (claimRoom(client.channel, client)) {
						send({
							cmd: 'alert',
							text: 'You are now the owner of this room, type \'' + config.commandPrefix + 'help\' and there should be new commands considering you are a channel owner of this room!'
						}, client);
					} else {
						send({
							cmd: 'alert',
							text: 'There was an error in claiming the room, sorry!'
						}, client);
					}
				}
			} else {
				if (d.owner === client.trip) {
					send({
						cmd: 'alert',
						text: 'You already own this room.'
					}, client);
				} else {
					send({
						cmd: 'alert',
						text: 'The user who owns this room trip is: ' + d.owner + '.'
					}, client);
				}
			}
		}
	},
	addadmin: {
		name: 'addadmin',
		help: 'Usage:\n' + config.commandPrefix + 'addadmin <The Users Trip here>\nIf the user does not have a trip tell them to do:\n' + config.commandPrefix + 'tripcode\nAnd then they have to login with that and send a message to see it. To remove a mod do:\n' + config.commandPrefix + 'removeadmin <Their Trip here>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('addadmins', args, client);
		},
		use: function (args, client) {
			var a = args.war[0];
			if (!a) {
				send({
					cmd: 'alert',
					text: this.help
				}, client);
				return;
			}

			if (rooms[client.channel].admins.indexOf(a) >= 0) {
				send({
					cmd: 'alert',
					text: 'The user with this trip is already a channel admin.'
				}, client);
			} else if (rooms[client.channel].mods.indexOf(a) >= 0) {
				send({
					cmd: 'alert',
					text: 'The user with this trip is a channel mod, if you want them to be an admin use:\n' + config.commandPrefix + 'promote ' + a + '\nor:\n' + config.commandPrefix + 'removemod ' + a + '\nthen: ' + config.commandPrefix + 'addadmin ' + a
				}, client);
			} else {
				rooms[client.channel].admins.push(a);
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + '\nis now an admin.'
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			}
		}
	},
	addmod: {
		name: 'addmod',
		help: 'Usage:\n' + config.commandPrefix + 'addmod <The Users Trip here>\nIf the user does not have a trip tell them to do:\n' + config.commandPrefix + 'tripcode\nAnd then they have to login with that and send a message to see it. To remove a mod do:\n' + config.commandPrefix + 'removemod <Their Trip here>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('addmods', args, client);
		},
		use: function (args, client) {
			var a = args.war[0];
			if (!a) {
				send({
					cmd: 'alert',
					text: this.help
				}, client);
				return;
			}
			if (rooms[client.channel].mods.indexOf(a) >= 0) {
				send({
					cmd: 'alert',
					text: 'The user with this trip is already a channel mod.'
				}, client);
			} else if (rooms[client.channel].admins.indexOf(a) >= 0) {
				send({
					cmd: 'alert',
					text: 'The user with this trip is a channel admin, if you want them to be a mod use:\n' + config.commandPrefix + 'demote ' + a + '\nor:\n' + config.commandPrefix + 'removeadmin ' + a + '\nthen: ' + config.commandPrefix + 'addmod ' + a
				}, client);
			} else {
				rooms[client.channel].mods.push(a);
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + '\nis now a mod.'
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			}
		}
	},
	promote: {
		name: 'promote',
		help: 'Usage:\n' + config.commandPrefix + 'promote <Trip of User you want to promote here>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('cmdpromote', args, client);
		},
		use: function (args, client) {
			var a = args.war[0];
			if (!a) {
				send({
					cmd: 'alert',
					text: this.help
				}, client);
				return;
			}

			if (rooms[client.channel].admins.indexOf(a) >= 0) {
				send({
					cmd: 'alert',
					text: 'That user is already a channel admin, they cannot be promoted further.'
				}, client);
			} else if (rooms[client.channel].mods.indexOf(a) >= 0) {
				rooms[client.channel].mods.splice(rooms[client.channel].mods.indexOf(a), 1);
				cmds.addadmin.use(args, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			} else {
				cmds.addmod.use(args, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			}
		}
	},
	demote: {
		name: 'demote',
		help: 'Usage:\n' + config.commandPrefix + 'demote <Trip of User you want to demote here>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('cmddemote', args, client);
		},
		use: function (args, client) {
			var a = args.war[0];
			if (!a) {
				send({
					cmd: 'alert',
					text: this.help
				}, client);
				return;
			}

			if (rooms[client.channel].admins.indexOf(a) >= 0) {
				rooms[client.channel].admins.splice(rooms[client.channel].admins.indexOf(a), 1);
				rooms[client.channel].mods.push(a);
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + ' is now no longer an admin, and is now a mod.'
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			} else if (rooms[client.channel].mods.indexOf(a) >= 0) {
				rooms[client.channel].mods.splice(rooms[client.channel].mods.indexOf(a), 1);
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + ' is now no longer a mod.'
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			} else if (rooms[client.channel].owner === a) {
				send({
					cmd: 'alert',
					text: 'You cannot demote yourself. If you want to transfer ownership of the room use:\n' + config.commandPrefix + 'transferownership\nIf you want to delete the room (Can not be gotten back) use:\n' + config.commandPrefix + 'deleteroom'
				}, client);
			} else {
				send({
					cmd: 'alert',
					text: 'That user is at the lowest rank, so you can not demote them.'
				}, client);
			}
		}
	},
	removeadmin: {
		name: 'removeadmin',
		help: 'Usage:\nRemoves a current admin:\n' + config.commandPrefix + 'removeadmin <trip of the admin to remove>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('removeadmins', args, client);
		},
		use: function (args, client) {
			var a = args.war[0];
			if (!a) {
				send({
					cmd: 'alert',
					text: this.help
				}, client);
				return;
			}

			if (rooms[client.channel].admins.indexOf(a) >= 0) {
				rooms[client.channel].admins.splice(rooms[client.channel].admins.indexOf(a), 1);
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + ' is no longer an admin.'
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			} else {
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + ' is not an admin.'
				}, client);
			}
		}
	},
	removemod: {
		name: 'removemod',
		help: 'Usage:\nRemoves a current mod:\n' + config.commandPrefix + 'removemod <trip of the admin to remove>',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('removemods', args, client);
		},
		use: function (args, client) {
			var a = args.war[0];
			if (!a) {
				send({
					cmd: 'alert',
					text: this.help
				}, client);
				return;
			}

			if (rooms[client.channel].mods.indexOf(a) >= 0) {
				rooms[client.channel].mods.splice(rooms[client.channel].mods.indexOf(a), 1);
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + ' is no longer a mod.'
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			} else {
				send({
					cmd: 'alert',
					text: 'The user with the trip: ' + a + ' is not a mod.'
				}, client);
			}
		}
	},
	kick: {
		name: 'kick',
		help: 'Usage:\n' + config.commandPrefix + 'kick nick',
		reqRank: 'sitemod',
		use: function (args, client) {
			COMMANDS.kick.run(args, client);
		}
	},
	ban: {
		name: 'ban',
		help: 'Usage:\n' + config.commandPrefix + 'ban nick',
		reqRank: 'sitemod',
		use: function (args, client) {
			COMMANDS.ban.run(args, client);
		}
	},
	chankick: {
		name: 'chankick',
		help: 'Usage:\n' + config.commandPrefix + 'chankick nick optionalChannel',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('kick', args, client);
		},
		use: function (args, client) {
			COMMANDS.chankick.run(args, client);
		}
	},
	chanban: {
		name: 'chanban',
		help: 'Usage:\n' + config.commandPrefix + 'chanban nick',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('ban', args, client);
		},
		use: function (args, client) {
			COMMANDS.chanban.run(args, client);
		}
	},
	listchanmods: {
		name: 'listchanmods',
		help: 'Usage:\nList all of the Channel Mods in this room:\n' + config.commandPrefix + 'listchanmods',
		use: function (args, client) {
			if (doesRoomExist(client.channel)) {
				send({
					cmd: 'alert',
					text: 'The users who are Channel Mods have the trips:\n' + rooms[client.channel].mods.join(', ') + '.'
				}, client);
			} else {
				send({
					cmd: 'alert',
					text: 'This is not a owned channel so there is no Channel Mod.'
				}, client);
			}
		}
	},
	listchanadmins: {
		name: 'listchanadmins',
		help: 'Usage:\nList all of the Channel Admins in this room:\n' + config.commandPrefix + 'listchanadmins',
		use: function (args, client) {
			if (doesRoomExist(client.channel)) {
				send({
					cmd: 'alert',
					text: 'The users who are Channel Admins have the trips:\n' + rooms[client.channel].admins.join(', ') + '.'
				}, client);
			} else {
				send({
					cmd: 'alert',
					text: 'This is not a owned channel so there is no Channel Admin.'
				}, client);
			}
		}
	},
	listchanowner: {
		name: 'listchanowner',
		help: 'Usage:\nTells the Channel Owner of this room:\n' + config.commandPrefix + 'listchanowner',
		use: function (args, client) {
			if (doesRoomExist(client.channel)) {
				send({
					cmd: 'alert',
					text: 'The Channel Owner has the trip:\n' + rooms[client.channel].owner + '.'
				}, client);
			} else {
				send({
					cmd: 'alert',
					text: 'This is not a owned channel so there is no Channel Owner.'
				}, client);
			}
		}
	},
	chanbroadcast: {
		name: 'chanbroadcast',
		help: 'Usage:\nBroadcasts the message on this channel, not too useful but it exists:\n' + config.commandPrefix + 'broadcast texty text text',
		reqRank: 'custom',
		check: function (args, client) {
			return canThey('broadcast', args, client);
		},
		use: function (args, client) {
			COMMANDS.chanbroadcast.run({
				text: args.war.join(' '),
				cmd: 'chanbroadcast'
			}, client);
		}
	},
	settings: {
		name: 'settings',
		penalize: 0.30,
		help: 'Usage:\nGet all settings and their values:\n' + config.commandPrefix + 'settings list\nGet a settings value:\n' + config.commandPrefix + 'settings get settingName\nSet a settings value:\n' + config.commandPrefix + 'settings set settingName true/false',
		reqRank: 'chanowner',
		use: function (args, client) {
			console.log(args.warl[1]);
			if (args.warl[0] === 'list') {
				//list all the settings
				var text = '';
				var ranOnce = false;
				var newLine = 0;
				for (var i in config.defaultSettings) {
					if (!ranOnce) {
						text += i + ': ' + getSetting(client.channel, i);
						ranOnce = true;
						newLine++;
					} else {
						text += '\n' + i + ': ' + getSetting(client.channel, i);
					}
					if (newLine === 3) {
						text + '\n';
						newLine = 0;
					} else {
						newLine++;
					}
				}
				send({
					cmd: 'alert',
					text: 'Settings:\n---------------------------\n' + text
				}, client);

				//}else if([undefined, null, false, NaN].indexOf(getSetting(client.channel, args.warl[1]))===-1){ //If it is not undefined,null, or false.
				//get a certain setting
			} else if (args.warl[0] === 'get') {
				send({
					cmd: 'alert',
					text: 'The value of the setting: ' + args.warl[1] + ' is:\n' + getSetting(client.channel, args.warl[1])
				}, client);
			} else if (args.warl[0] === 'set') {
				//i should probably modify this code for whenever i want to have more than just true or false :(
				var val = getSetting(client.channel, args.warl[1]); //so by default it will be the value already set 
				if (['true', 'yes', 't', 'y', 'definitely'].indexOf(args.warl[2]) >= 0) {
					val = true;
				} else if (['false', 'no', 'not', 'f', 'n', 'nope'].indexOf(args.warl[2]) >= 0) {
					val = false;
				} else if (['', 'giboppls', 'gr8b8m8', 'imkindatired'].indexOf(args.warl[2]) >= 0) {
					send({
						cmd: 'alert',
						text: 'Please actually input a value of true or false.'
					}, client);
					return;
				}

				if (!doesRoomExist(client.channel) || !isChanOwner(client)) {
					send({
						cmd: 'alert',
						text: 'You are in a room that is not owned by you, so you cannot use the settings command.'
					}, client);
					return;
				}

				rooms[client.channel].settings[args.warl[1]] = val;
				send({
					cmd: 'alert',
					text: 'The value of the setting \'' + args.warl[1] + '\' has been set to \'' + val + '\''
				}, client);
				writeJSON(roomsFilename, rooms, 'rooms');
			} else {
				send({
					cmd: 'alert',
					text: 'I do not know what command you want to run on that setting.\nUse ' + config.commandPrefix + 'help settings'
				}, client);
			}
		}
		//}
	},
	/* Currently not finished
	mute: {
		name: 'settings',
		penalize: 0.20, //so it is easy to mute like everyone in a room if need be
		help: 'Usage:\nMute a person by username, until unmuted:\n' + config.commandPrefix + 'mute nickname',
		reqRank: 'custom',
		check: function(args, client){
			return canThey('mute', args, client);
		},
		use: function(args, client){
			var mutedClient = server.clients.filter(function (client) {
				return client.channel == client.channel && client.nick == nick;
			}, client)[0];

			if(args.warl[0] !== undefined && args.warl[0] !== '' && (mutedClient.length >= 1)){
				rooms[client.channel].muted.push(args.warl[0]);
				send({
					cmd: 'alert',
					text: 'The user with the username: \'' + args.warl[0] + '\' is now muted. All users with that username will be muted, do:\n' + config.commandPrefix  + 'unmute nickname\nto unmute them.'
				}, client);
			}else{
				send({
					cmd: 'alert',
					text: 'The user with the nick: \'' + args.warl[0] + '\' was not found.'
				}, client);
			}
		}
	},
	unmute: {
		name: 'unmute',
		penalize: 0.20,
		help: '',
		reqRank: 'custom',
		check: function(args, client){
			return canThey('unmute', args, client);
		},
		use: function(args, client){
			
		}
	}*/
};

// `this` bound to client - NOT ANY MORE, its just annoying especially when you want to use 'this', why not just have an arg for the client??
var COMMANDS = {
	ping: {
		name: 'ping',
		penalize: 0.25, //make so it barely penalizes them at all
		run: function (args, client) {
			// Don't do anything
		}
	},
	cmd: {
		name: 'cmd',
		penalize: 0.75,
		run: function (args, client) {
			args.ar = args.text.split(' ');
			args.arl = args.text.toLowerCase().split(' ');
			args.war = args.ar.slice(1, args.ar.length);
			args.warl = args.arl.slice(1, args.arl.length);

			if (cmds[args.arl[0]] !== undefined && badProps.indexOf(cmds[args.arl[0]]) === -1) {
				if (cmds[args.arl[0]].reqRank !== undefined) {
					if (cmds[args.arl[0]].reqRank === 'custom') {
						//lets me do custom checks.
						if (!cmds[args.arl[0]].check(args, client)) {
							send({
								cmd: 'alert',
								text: 'You are not the required rank to use this command, sorry.'
							}, client);
							return;
						}
					} else if (!isReqRank(cmds[args.arl[0]].reqRank, client)) {
						send({
							cmd: 'alert',
							text: 'You are not the required rank to use this command, sorry.'
						}, client);
						return;
					}
				}
				cmds[args.arl[0]].use(args, client);
			} else {
				send({
					cmd: 'alert',
					text: 'Error: That command was not found.\nPerhaps try /help'
				}, client);
			}

		}
	},
	leave: {
		name: 'leave',
		penalize: 0.70,
		run: function (args, client) {
			try {
				if (client.channel) {
					broadcast({
						cmd: 'onlineRemove',
						nick: client.nick
					}, client.channel);
				}
			} catch (e) {
				console.warn(e.stack);
			}
			client.channel = '';
		}
	},
	join: {
		name: 'join',
		penalize: 0.80,
		run: function (args, client, custTrip) {

			var channel = String(args.channel);
			var nick = String(args.nick);
			if (POLICE.frisk(getAddress(client), 2)) {
				send({
					cmd: 'warn',
					text: "You are joining channels too fast. Wait a moment and try again."
				}, client);
				return;
			}
			if (client.nick && !custTrip) {
				// Already joined
				return;
			}
			// Process channel name
			channel = channel.trim();
			if (!channel) {
				// Must join a non-blank channel
				return;
			}
			// Process nickname
			var nickArr = nick.split('#', 2);
			nick = nickArr[0].trim();

			if (!nicknameValid(nick)) {
				send({
					cmd: 'warn',
					text: "Nickname must consist of up to 24 letters, numbers, and underscores"
				}, client);
				return;
			}
			var password = nickArr[1];
			/*if (nick.toLowerCase() == config.admin.toLowerCase()) {
				if (password != config.password) {
					send({
						cmd: 'warn',
						text: "Cannot impersonate the admin"
					}, client)
					return
				}
			} else if (password) {
				client.trip = hash(password)
			}*/
			var c = [];
			var d = [];
			config.admins.map(function (a, b) {
				c.push(a[0].toLowerCase());
				d.push(a[1]);
			});
			if (c.indexOf(nick.toLowerCase()) >= 0) {
				if (hash(password) !== d[c.indexOf(nick.toLowerCase())]) {
					send({
						cmd: 'warn',
						text: "Cannot impersonate a admin."
					}, client);
					return;
				}
			}
			if (password) {
				client.trip = hash(password);
			}
			if (!!custTrip) {
				client.trip = custTrip;
			}
			var address = getAddress(client);
			for (var cli of server.clients) {
				if (cli.channel === channel) {
					if (cli.nick.toLowerCase() === nick.toLowerCase()) {
						send({
							cmd: 'warn',
							text: "Nickname taken"
						}, client);
						return;
					}
				}
			}
			// Announce the new user
			broadcast({
				cmd: 'onlineAdd',
				nick: nick
			}, channel);

			// Formally join channel
			client.channel = channel;
			client.nick = nick;

			// Set the online users for new user
			var nicks = [];
			for (var cli2 of server.clients) {
				if (cli2.channel === channel) {
					nicks.push(cli2.nick);
				}
			}
			send({
				cmd: 'onlineSet',
				nicks: nicks
			}, client);
		}
	},
	chat: {
		name: 'chat',
		run: function (args, client) {
			var text = String(args.text);
			if (!client.channel) {
				return;
			}
			if (!canThey('chat', args, client)) {
				send({
					cmd: 'alert',
					text: 'You are not allowed to chat here.'
				}, client);
				return;
			}
			// strip newlines from beginning and end
			text = text.replace(/^\s*\n|^\s+$|\n\s*$/g, '');
			// replace 3+ newlines with just 2 newlines
			text = text.replace(/\n{3,}/g, "\n\n");
			if (!text) {
				return;
			}
			if (text[0] === config.commandPrefix) {
				args.text = args.text.replace(new RegExp(config.commandPrefix), '');
				COMMANDS.cmd.run(args, client);
				return;
			}

			var score = text.length / 83 / 4;
			if (POLICE.frisk(getAddress(client), score)) {
				send({
					cmd: 'warn',
					text: "You are sending too much text. Wait a moment and try again.\nPress the up arrow key to restore your last message."
				}, client);
				return;
			}

			var data = {
				cmd: 'chat',
				nick: client.nick,
				text: text
			};
			if (isAdmin(client)) {
				data.admin = true;
			} else if (isMod(client)) {
				data.mod = true;
			} else if (isChanOwner(client)) {
				data.chanowner = true;
			} else if (isChanAdmin(client)) {
				data.chanadmin = true;
			} else if (isChanMod(client)) {
				data.chanmod = true;
			}

			if (this.trip) {
				data.trip = this.trip;
			}
			if (client.trip && !isAdmin(client)) { //stops admin trips from being sent
				data.trip = client.trip;
			}
			broadcast(data, client.channel);
		}
	},
	invite: {
		name: 'invite',
		run: function (args, client) {
			var nick = String(args.nick);
			if (!client.channel) {
				return;
			}

			if (POLICE.frisk(getAddress(client), 2)) {
				send({
					cmd: 'warn',
					text: "You are sending invites too fast. Wait a moment before trying again."
				}, client);
				return;
			}

			var friend;
			for (var cli of server.clients) {
				// Find friend's client
				if (cli.channel == client.channel && cli.nick == nick) {
					friend = cli;
					break;
				}
			}
			if (!friend) {
				send({
					cmd: 'warn',
					text: "Could not find user in channel"
				}, client);
				return;
			}
			if (friend == client) {
				// Ignore silently
				return;
			}
			var channel = Math.random().toString(36).substr(2, 8);
			send({
				cmd: 'info',
				text: "You invited " + friend.nick + " to ?" + channel
			}, client);
			send({
				cmd: 'info',
				text: client.nick + " invited you to ?" + channel
			}, friend);
		}
	},
	stats: {
		name: 'stats',
		penalize: 0.5,
		run: function (args, client) {
			var ips = {};
			var channels = {};
			for (var cli of server.clients) {
				if (cli.channel) {
					channels[cli.channel] = true;
					ips[getAddress(cli)] = true;
				}
			}
			send({
				cmd: 'info',
				text: Object.keys(ips).length + " unique IPs in " + Object.keys(channels).length + " channels"
			}, client);
		}
	},
	//ChanOwner only commands beyond this point

	//chan admin only commands beyond this point
	chanbroadcast: {
		name: 'chanbroadcast',
		penalize: 0.8,
		run: function (args, client) {
			if (!canThey('broadcast', args, client)) {
				return;
			}
			var text = String(args.text);
			broadcast({
				cmd: 'info',
				text: "Channel broadcast: " + text
			}, client.channel);
		}
	},
	//chan mod only commands beyond this point
	chanban: {
		name: 'chanban',
		penalize: 0.6, //so banning large amounts of people is easier, this is good and bad :/
		run: function (args, client) {
			if (!canThey('ban', args, client)) {
				return;
			}

			var nick = String(args.nick);
			if (!client.channel) {
				return;
			}

			var badClient = server.clients.filter(function (client) {
				return client.channel == client.channel && client.nick == nick;
			}, client)[0];

			if (!badClient) {
				send({
					cmd: 'warn',
					text: "Could not find " + nick
				}, client);
				return;
			}

			if (isChanMod(badClient)) {
				send({
					cmd: 'warn',
					text: "Cannot ban moderator"
				}, client);
				return;
			}

			rooms[this.client].banned.push(getAddress(badClient));
			writeJSON(roomsFilename, rooms, 'rooms');
			logIt(client.nick + " [" + client.trip + "] banned " + nick + " [" + badClient.trip + "] in " + client.channel);
			broadcast({
				cmd: 'info',
				text: client.nick + " banned user '" + nick + '\' from this channel.'
			}, client.channel);
			badClient.close(); //after so they can see they have been banned.
		}
	},
	chankick: {
		name: 'chankick',
		penalize: 0.50,
		run: function (args, client) {
			if (!canThey('kick', args, client)) {
				return;
			}

			var nick = String(args.nick);
			var customLoc = '';
			if (nick === undefined || nick === 'undefined') {
				nick = args.war[0];
				if (emptyVals.indexOf(args.war[1])) {
					customLoc = args.war[1].replace('?');
				}
			}
			if (!client.channel) {
				return;
			}

			var badClient = server.clients.filter(function (client) {
				return client.channel == client.channel && client.nick == nick;
			}, client)[0];

			if (!badClient) {
				send({
					cmd: 'warn',
					text: "Could not find " + nick
				}, client);
				return;
			}

			if (isChanMod(badClient)) {
				send({
					cmd: 'warn',
					text: "Cannot kick channel mod or higher."
				}, client);
				return;
			}

			//POLICE.frisk(getAddress(badClient), 25); //Hopefully isn't too bad.

			//badClient.close(); //closes their connection
			logIt(client.nick + " [" + client.trip + "] kicked " + nick + " [" + badClient.trip + "] in ?" + client.channel + ' to ?' + ((customLoc === '') ? config.kickRoom : customLoc));
			broadcast({
				cmd: 'info',
				text: client.nick + " kicked " + nick + ' to ?' + ((customLoc === '') ? config.kickRoom : customLoc)
			}, client.channel);
			COMMANDS.leave.run(args, badClient);
			COMMANDS.join.run({
				nick: nick + Math.random().toString(36).substr(2, 23 - nick.length),
				channel: ((customLoc === '') ? config.kickRoom : customLoc),
				cmd: 'join'
			}, badClient, badClient.trip);
			send({
				cmd: 'warn',
				text: 'You have been kicked to ?' + ((customLoc === '') ? config.kickRoom : customLoc)
			}, badClient);
		}
	},

	// Moderator-only commands below this point

	ban: {
		name: 'ban',
		penalize: 0.5, //so banning large amounts of people is easier, this is good and bad :/
		run: function (args, client) {
			if (!isMod(client)) {
				return;
			}

			var nick = String(args.nick);
			if (!client.channel) {
				return;
			}

			var badClient = server.clients.filter(function (client) {
				return client.channel == client.channel && client.nick == nick;
			}, client)[0];

			if (!badClient) {
				send({
					cmd: 'warn',
					text: "Could not find " + nick
				}, client);
				return;
			}

			if (isMod(badClient)) {
				send({
					cmd: 'warn',
					text: "Cannot ban moderator"
				}, client);
				return;
			}

			POLICE.arrest(getAddress(badClient));

			logIt(client.nick + " [" + client.trip + "] banned " + nick + " [" + badClient.trip + "] in ?" + client.channel);
			broadcast({
				cmd: 'info',
				text: "Banned " + nick
			}, client.channel);
			client.close();
		}
	},
	kick: {
		name: 'kick',
		penalize: 0.40,
		run: function (args, client) {
			if (!isMod(client)) {
				return;
			}

			var nick = String(args.nick);
			if (!client.channel) {
				return;
			}

			var badClient = server.clients.filter(function (client) {
				return client.channel == client.channel && client.nick == nick;
			}, client)[0];

			if (!badClient) {
				send({
					cmd: 'warn',
					text: "Could not find " + nick
				}, client);
				return;
			}

			if (isMod(badClient)) {
				send({
					cmd: 'warn',
					text: "Cannot kick moderator or above."
				}, client);
				return;
			}

			POLICE.frisk(getAddress(badClient), 30); //Hopefully isn't too bad.
			logIt(client.nick + " [" + client.trip + "] kicked " + nick + " [" + badClient.trip + "] in ?" + client.channel);
			broadcast({
				cmd: 'info',
				text: client.nick + " kicked " + nick
			}, client.channel);
			client.close(); //closes their connection
		}
	},
	// Admin-only commands below this point

	listUsers: {
		name: 'listUsers',
		penalize: 0.25, //so it can still ratelimit, but it will be less since it is an admin
		run: function (args, client) {
			if (!isAdmin(client)) {
				return;
			}
			var channels = {};
			for (var cli of server.clients) {
				if (cli.channel) {
					if (!channels[cli.channel]) {
						channels[cli.channel] = [];
					}
					channels[cli.channel].push(cli.nick);
				}
			}

			var lines = [];
			for (var channel in channels) {
				lines.push("?" + channel + " " + channels[channel].join(", "));
			}
			var text = server.clients.length + " users online:\n\n";
			text += lines.join("\n");
			send({
				cmd: 'info',
				text: text
			}, client);
		}
	},

	broadcast: {
		name: 'broadcast',
		penalize: 0.4,
		run: function (args, client) {
			if (!isAdmin(client)) {
				return;
			}
			var text = String(args.text);
			broadcast({
				cmd: 'info',
				text: "Server broadcast: " + text
			});
		}
	}
};


// rate limiter
var POLICE = {
	records: {},
	halflife: 30000, // ms
	threshold: 15,
	loadJail: function (filename) {
		var ids;
		try {
			var text = fs.readFileSync(filename, 'utf8');
			ids = text.split(/\r?\n/);
		} catch (e) {
			return;
		}
		for (var id of ids) {
			if (id && id[0] != '#') {
				this.arrest(id);
			}
		}
		logIt("Loaded jail '" + filename + "'");
	},

	search: function (id) {
		var record = this.records[id];
		if (!record) {
			record = this.records[id] = {
				time: Date.now(),
				score: 0,
			};
		}
		return record;
	},

	frisk: function (id, deltaScore) {
		var record = this.search(id);
		if (record.arrested) {
			return true;
		}

		record.score *= Math.pow(2, -(Date.now() - record.time) / POLICE.halflife);
		record.score += deltaScore;
		record.time = Date.now();
		if (record.score >= this.threshold) {
			return true;
		}
		return false;
	},

	arrest: function (id) {
		var record = this.search(id);
		if (record) {
			record.arrested = true;
		}
	},
};

POLICE.loadJail('jail.txt');