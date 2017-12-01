import * as moment from 'moment';
import http from 'http';
import express from 'express';
import cors from 'cors';
import io from 'socket.io';
import config from '../config/config.json';
import path from 'path';
import mongo, { MongoClient } from 'mongodb';

var users = [];
var converter_users = [];
var connected_users = [];
// setup server
const app = express();
const server = http.createServer(app);

const socketIo = io(server);

// Allow CORS
app.use(cors());

// Render a API index page
app.get('/:id', (req, res) => {
  res.sendFile(path.resolve('public/messenger.html'));
});

app.get('/public/moment.min.js', (req, res)=>{
  res.sendFile(path.resolve('public/moment.min.js'));
});

// Start listening
server.listen(process.env.PORT || config.port);
console.log(`Started on port ${config.port}`);


// Setup socket.io
socketIo.sockets.on('connection', socket => {
  const email = socket.handshake.query.email;
  const users_id = socket.handshake.query.id;
  var receiver_id;
  var room_messages = [];
  var room_id = 0;
  console.log(`${email} connected`);

  mongo.connect('mongodb://localhost:27017/chat', function(err, db){
    if (err){ console.log('Error: '+err);}
    else{
      var collection = db.collection('messages');
      console.log(`database connected: socket id ${socket.id}`);
      collection.aggregate([
        { $match: 
          {$or: [
            {'sender_id':users_id.toString()}, 
            {'receiver_id':users_id.toString()}
          ]} 
        },
        {'$group':{_id:"$room_id", messages:{ $sum:1}}}, 
        {$sort:{date:1}}, 
        {$limit:10}
      ]).toArray( function(err, result) {

        if (err) { console.log( err.message );}
        else{
          var rooms_convo = [];
          if(result.length == 0) {
            console.log('no room convo found');
          }else{
            rooms_convo = result;
          }        
          console.log(rooms_convo, ' hits');
          console.log('welcome to server');
          socket.emit('server:welcome', rooms_convo);

        }
      });
      //push users data to connected users
      if ( updateConnection(users_id, connected_users )){
        console.log('User is already connected');
      }else{
        connected_users.push({'users_id':users_id, 'email':email, 'socket_id': socket.id})
      }
      console.log(connected_users, 'connected users');
      console.log(connected_users.length, 'connected length');
      console.log('Connected: %s users connected', connected_users.length);
    }
  });
  
  socket.on('join:room', details => {
    console.log(details.room, 'room_id');
    room_id = details.room;
    receiver_id = details.receiver_id;
    socket.join(room_id.toString());
    console.log(`${users_id} has joined room ${details.room}`);
    mongo.connect('mongodb://localhost:27017/chat', function(err, db){
      if (err) { console.log('Error: '+err.message); }
      else{
        var collection = db.collection('rooms');
        var msg_coll = db.collection('messages');;
        collection.find({ room_id:room_id.toString() }).sort({date:1}).toArray( function(err1, result){
          if (err1) { console.log('error sa room: '+err1.message) }
          else{
            if ( !result.length ){
              collection.save({room_id:room_id.toString()});
              sendBackData(room_id.toString(), room_messages);
            }else{
              msg_coll.find({room_id:room_id.toString()}).sort({date:-1}).toArray( function( err2, result ){
                if ( err2 ){ console.log('Error getting messages'); }
                else { 
                  room_messages = result; 
                  sendBackData(room_id.toString(), room_messages);
                } 
              }); 
            }
          console.log(result, 'room');
          }
        }); 
      }
    });
  });

  socket.on('send:chat', msg => {
          mongo.connect('mongodb://localhost:27017/chat', function(err3, db){
            if ( err3 ){ console.log(err3.message) }
            else{ 
              var collection = db.collection('messages');
              var envelope = {
                room_id: room_id.toString(),
                sender_id: users_id,
                receiver_id:receiver_id,
                message:msg,
                date:Date()
              };
              console.log(envelope, 'sent');
              collection.save(envelope);
              console.log(`message sent by ${users_id} to room ${room_id}`);
              collection.find({room_id:room_id.toString()}).sort({ date: -1}).toArray( (err, result) =>{
                if ( err ){ console.log(err.message);}
                else{
                  var receiver_socket_id = searchSocketId(envelope.receiver_id, connected_users);
                  console.log(receiver_socket_id, 'receiver_socket_id')
                  socketIo.sockets.in(room_id.toString()).emit('send:chat', result);
                  console.log(`Message sent. From ${users_id} to room ${room_id}`);
                }
              });
              sendNotification(envelope.receiver_id, email);
            }
          });
        });
   
  socket.on('new:convo', envelope => {
    var receiver_socket_id = searchSocketId(envelope.receiver_id, connected_users);
    
    console.log(receiver_socket_id, 'new conv');
    sendNewConvo(receiver_socket_id.toString(), envelope);
  });
  function sendNewConvo(receiver, envelope){
    console.log(`sending new convo to ${envelope.receiver_id}`)
    socket.to(receiver).emit('new:convo', envelope);
    socket.to(receiver).emit('server:welcome', envelope);
  }
  function sendNotification(receiver_id, email){
    socket.to(searchSocketId(receiver_id, connected_users)).emit('notify:me', {notify:'New message from '+email});

  }
  function sendBackData(room, msg){
    var envelope = {
      msg:msg,
      _id:room
    };
    socketIo.sockets.in(room).emit('room:messages', envelope);
    console.log(msg, 'room messages'); 
  }

  function searchSocketId(users_id, connected){
    for (var i=0; i < connected.length; i++) {
        if (connected[i].users_id === users_id) {
            return connected[i].socket_id;
        }
    }
  }

  function updateConnection(users_id, connected){
    for( var i in connected){
      if( connected[i].users_id === users_id){
        connected_users[i].socket_id = socket.id;
        return true;
        break;
      }else{
        return false;
      }
    }
  }




  socket.on('disconnect', () => {
    console.log(`${users_id} disconnected`);
    var idx = connected_users.indexOf( users_id );
    if(idx > -1) {
          connected_users.splice(idx,1);
    }
    console.log('Connected: %s users connected', connected_users.length);
    socket.emit('server:update_status', users);

  });
});

export default app;
