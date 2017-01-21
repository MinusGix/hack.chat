# Minux.Chat
## Where it came from:
This is a fork of hack.chat, which was made by Andrew Belt
It came from me having a random idea to make so you could own rooms, then I just added stuff and so on.

## Commands in the chat:
These are some (only some) of the commands you can use in a room, some of these can be disabled/changed who can use them by the channel owner.

`/help` - shows the hlp

`/claimroom` - claims a room for yourself, must have a trip

`/tripcode`  - shows you how to get a tripcode

`/whisper`   - sends a message to another use in the same room, no one, not even the channel owner or site admin can see these.

`/chanban`   - if you are a channel moderator or higher in a room you can ban users from the room (Unless the channel owner changes it.)

`/chanmod`   - if you are a channel moderator or higher in a room you can kick users from the room to another room (Could be used for afk systems)

And several more.



## Where it is hosted:
Currently it is hosted at [MinuxGix.tk](http://minuxgix.tk/) (Not yet actually)

## How to Install it so you can modify it:
First: Open a command prompt in the folder where you can see server.js
Then follow these commands:
```
npm install ws
npm install http-server -g
```

### Running it:
To run it you will need two separate command prompts/terminals.
In one of them, which should be open to where the server.js is type
```
node server.js
```
It will tell you some things, ignore them for now.

Then goto /client/ where client.js is and do
```
http-server
```
Which will start it up locally, it's up to you to put it on a server.
The 2nd console will show what to go to to view it locally.