const path = require('path');

module.exports = {
  entry: './bundler.js',
  output: {
    path: path.resolve(__dirname, 'js'),
    filename: 'mediasoup-client.min.js',
    library: 'mediasoupClient',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  mode: 'production',
  optimization: {
    minimize: true
  }
};