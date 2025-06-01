// module.exports = {
//   listenIp: '0.0.0.0',
//   listenPort: 3000,
//   mediasoup: {
//     worker: {
//       rtcMinPort: 10000,
//       rtcMaxPort: 20000,
//       logLevel: 'debug',
//       logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp']
//     },
//     router: {
//       mediaCodecs: [
//         {
//           kind: 'audio',
//           mimeType: 'audio/opus',
//           clockRate: 48000,
//           channels: 2
//         },
//         {
//           kind: 'video',
//           mimeType: 'video/VP8',
//           clockRate: 90000,
//           parameters: { 'x-google-start-bitrate': 1000 }
//         }
//       ]
//     },
//     webRtcTransport: {
//       listenIps: [{ ip: '127.0.0.1', announcedIp: '127.0.0.1' }],
//       initialAvailableOutgoingBitrate: 1000000,
//       minimumAvailableOutgoingBitrate: 500000
//     }
//   },
//   turnServers: [
//     // {
//     //   urls: ['turn:127.0.0.1:3478'],
//     //   username: 'turnuser',
//     //   credential: 'turnpassword'
//     // }
//   ]
// };

module.exports = {
  listenIp: '127.0.0.1',
  listenPort: 5000,
  
  mediasoup: {
    worker: {
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
      logLevel: 'debug',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
        'rtx',
        'bwe',
        'score',
        'simulcast',
        'svc'
      ]
    },
    
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        }
      ]
    },
    
    webRtcTransport: {
      listenIps: [
        {
          ip: '127.0.0.1',
          announcedIp: null
        }
      ],
      maxIncomingBitrate: 1500000,
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      maxSctpBufferedAmount: 262144,
      sctpSendBufferSize: 262144,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      preferTcp: false
    }
  }
};