fx_version 'cerulean'
game 'gta5'

author 'ZombieAdictosRP'
description 'Server-side screen recording via WebGL capture and Discord upload'
version '1.0.0'

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/recorder.js',
    'html/fix-webm-duration.js',
}

shared_script 'config.lua'
server_script 'server.lua'
client_script 'client.lua'
