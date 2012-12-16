function log(msg) {
    if (console && console.log) {
        console.log(msg);
    }
}

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return 'n/a';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

function getFileName(path) {
    return path.replace(/^.*[\\\/]/, '');
}

function isDirectory(path) {
    return path.substr(-5).indexOf('.') === -1;
}

function sendFB(description) {
    FB.ui(
        {
            method      : 'send',
            link        : 'http://apps.facebook.com/' + $("meta[property='og:namespace']").attr("content"),
            description : description
        },
        function (response) {
        // If response is null the user canceled the dialog
            if (response != null) {
                log(response);
            }
        }
    );
}

jQuery(function() {
    //we're using server side templating in ejs, which uses erb templating as well,
    //so we need to change underscore's syntax so we can have client templates within
    //server templates
    _.templateSettings = {
        interpolate: /\<\@\=(.+?)\@\>/gim,
        evaluate: /\<\@(.+?)\@\>/gim
    };

    var FileView = Backbone.View.extend({
        className: 'file row',
        initialize: function() {
            this.template = _.template($('#file_template').html());
            this.model.on('destroy', this.destroy, this);
        },
        destroy: function() {
            this.model.off('destroy', this.destroy, this);
            this.unbind();
            this.remove();
        },
        render: function() {
            this.$el.html(this.template({
                name: getFileName(this.model.get('properties').get('name')),
                size: bytesToSize(this.model.get('properties').get('size'))
            }));
            return this;
        }
    });

    var FileListView = Backbone.View.extend({
        initialize: function() {
            this.model.on('destroy', this.destroy, this);
            _.defer(_.bind(this.model.live, this.model, 'file *', this.onFile, this));
        }, 
        destroy: function() {
            this.model.off('destroy', this.destroy, this);
            this.model.die('file *', this.onFile, this);
            this.unbind();
            this.remove();
        },
        onFile: function(file, files) {
            var view = new FileView({
                model: file
            });
            this.$el.append(view.render().el);
        },
        render: function() {
            return this;
        }
    });

    var BundleView = Backbone.View.extend({
        className: 'bundle row well',
        initialize: function() {
            this.template = _.template($(this.templateId).html());
            this.model.on('destroy', this.destroy, this);
            this.files = new FileListView({
                model: this.model
            });
        },
        assign : function (view, selector) {
            view.setElement(this.$(selector)).render();
        },
        destroy: function() {
            this.model.off('destroy', this.destroy, this);
            this.unbind();
            this.remove();
        }
    });

    var SelfBundleView = BundleView.extend({
        templateId: '#self_bundle_template',
        events: {
            'click .share': 'onShare',
            'click .open': 'onOpen',
            'click .remove': 'onRemove'
        },
        initialize: function() {
            BundleView.prototype.initialize.apply(this, arguments);
            this.model.get('properties').on('change:progress', this.onProgress, this);
        },
        onShare: function() {
            sendFB('Sharing a ' + this.model.get('file').length + ' file bundle: ' + this.model.get('properties').get('name'));
        },
        onOpen: function() {
            this.model.open_containing();
        },
        onRemove: function() {
            this.$el.hide();
            this.model.remove().then(_.bind(function() {
                this.$el.remove();
            }, this), _.bind(function() {
                this.$el.show();
            }, this));
        },
        onProgress: function() {
            this.$('.fb-progress>.fb-bar').css(
                'width', 
                this.model.get('properties').get('progress') / 10.0 + '%'
            );
        },
        render: function() {
            this.$el.html(this.template({
                name: this.model.get('properties').get('name'),
                progress: this.model.get('properties').get('progress') / 10.0 + '%'
            }));
            this.assign(this.files, '.files');
            return this;
        }
    });

    /**
     *  Is responsible for providing the UI for a torrent on a friends machine
    **/
    var FriendBundleView = BundleView.extend({
        templateId: '#friend_bundle_template',
        events: {
            'click .download': 'onDownload'
        },
        initialize: function() {
            BundleView.prototype.initialize.apply(this, arguments);
            this.options.local.live('torrent ' + this.model.id, this.checkLocalExists, this);
        },
        // We just added the torrent that is listed...disabled the download button
        localAdded: function(torrent) {
            torrent.on('destroy', this.localRemoved, this);
            this.$('.btn').addClass('disabled');
            this.$('.btn > div').removeClass('download').addClass('ok');
        },
        // We just deleted the torrent from the local machine...enabled downloading it again
        localRemoved: function() {
            this.$('.btn').removeClass('disabled');
            this.$('.btn > div').addClass('download').removeClass('ok');
        },
        // Handles the case where the local machine now has the torrent listed in a friends list,
        // and visa versa...should be a disabled check when we already have it, otherwise a dl btn
        checkLocalExists: function() {
            var torrent = this.options.local.get('torrent').get(this.model.id);
            if(!!torrent) {
                this.localAdded(torrent);
            } else {
                this.localRemoved();
            }
        },
        // Handles clicks to the download button
        onDownload: function() {
            // Make sure we only handle events from the button when its not disabled
            if(!this.$('.btn').hasClass('disabled')) {
                this.options.local.get('torrent').download({
                    url: this.model.get('properties').get('uri')
                });
            }
        },
        render: function() {
            var disabled = !_.isUndefined(this.options.local.get('torrent').get(this.model.id));
            this.$el.html(this.template({
                name: this.model.get('properties').get('name'),
                disabled: disabled,
                ok: disabled,
                download: !disabled
            }));
            this.assign(this.files, '.files');
            return this;
        }
    });

    var BundleListView = Backbone.View.extend({
        initialize: function() {
            this.model.live('torrent *', this.onTorrent, this);
        },
        onTorrent: function(torrent, torrents) {
            var view = this.createBundleView(torrent);
            this.$el.append(view.render().el);
        },
        render: function() {
            return this;
        }
    });

    var SelfBundleListView = BundleListView.extend({
        createBundleView: function(bundle) {
            return new SelfBundleView({
                model: bundle
            });
        }
    });

    var FriendBundleListView = BundleListView.extend({
        createBundleView: function(bundle) {
            return new FriendBundleView({
                model: bundle,
                local: this.options.local
            });
        }
    });

    var ShareBundle = Backbone.Model.extend({
        defaults: {
            status: 'Warming up...',
            progress: 0,
            complete: false
        },
        initialize: function() {
            var handles = _(this.get('files')).pluck('handle');
            this.get('btapp').get('torrent').generate({
                files: handles,
                callback: _.bind(this.onSuccess, this),
                error: _.bind(this.onError, this),
                progress: _.bind(this.onProgress, this)
            });
        },
        onError: function(msg) {
            this.set({
                status: 'Horrible failure!',
                progress: 0
            });
        },
        onComplete: function(files, torrent, torrents) {
            this.get('btapp').die('torrent ' + this.get('hash'), this.onComplete, this);
            this.set({
                complete: true,
                status: 'Successfully sharing files!',
            });
        },
        onSuccess: function(hash) {
            this.set({
                hash: hash
            });
            this.get('btapp').live('torrent ' + this.get('hash') + ' file', this.onComplete, this);
            this.set({
                progress: 100
            });
        },
        onProgress: function(msg) {
            this.set({
                status: 'Bundling...',
                progress: msg,
            });
        }
    });

    var ShareBundleDialog = Backbone.View.extend({
        className: 'modal fade',
        events: {
            'click .tell': 'tell'
        },
        initialize: function() {
            this.template = _.template($('#bundling_template').html());
            $('body').append(this.$el);
            this.$el.html(this.template({
                files: this.model.get('files'),
                status: this.model.get('status')
            }));

            this.model.on('change:status', function() {
                this.$('.status').text(this.model.get('status'));
            }, this);

            this.model.on('change:progress', function() {
                var progress = this.model.get('progress');
                this.$('.fb-progress>.fb-bar').css('width', progress + '%');
            }, this);

            this.model.on('change:complete', function() {
                if(this.model.get('complete')) {
                    this.$('.tell').removeClass('disabled');
                }
            }, this);

            this.$el.modal({
                show: true,
                backdrop: true
            });
            this.$el.on('hidden', _.bind(function() {
                this.remove();
            }, this));
        },
        tell: function() {
            var tell = this.$('.tell');
            this.$el.modal('hide');
            var count = this.model.get('btapp').get('torrent').get(this.model.get('hash')).get('file').length;
            var description = this.model.get('name') + 
                ' just shared ' + 
                count + ' file' + 
                (count === 1 ? '' : 's') +
                ' using BeamItOver.';
            sendFB(description);
        }
    });

    var User = Backbone.Model.extend({
        trackStatus: function() {
            this.set('status', 'connecting');
            this.get('btapp').on('client:connected', this.onConnect, this);
            this.get('btapp').on('disconnect', this.onDisconnect, this);
            this.get('btapp').on('client:error', this.onError, this);
        },
        onConnect: function() {
            this.set('status', 'online');
        },
        onDisconnect: function() {
            this.set('status', 'offline');
        },
        onError: function() {
            this.set('status', 'error');
        }
    });

    var Friend = User.extend({
        initialize: function() {
            var btapp = new Btapp();
            btapp.connect(this.get('credentials'));
            this.set({
                btapp: btapp
            });
            btapp.on('client:error', this.reconnect, this);
            this.trackStatus();
        },
        reconnect: function() {
            setTimeout(_.bind(function() {
                this.set('status', 'connecting');
                setTimeout(_.bind(function() {
                    this.get('btapp').connect(this.get('credentials'));
                }, this), 1000);
            }, this), 15000);
        }
    });

    var Self = User.extend({
        initialize: function() {
            var btapp = new Btapp();
            btapp.connect();
            this.set({
                btapp: btapp
            });
            this.get('btapp').on('add:connect_remote', this.onConnectRemote, this);
            this.get('btapp').on('remoteStatus', this.onRemoteStatus, this);
            this.get('btapp').live('torrent *', function(torrent) {
                console.log('TORRENT', torrent.id);
            }, this);
            this.trackStatus();
        },
        onConnectRemote: function() {
            log('onConnectRemote');
            var username = this.get('credentials').username;
            var password = this.get('credentials').password;
            log(username, password);
            var req = this.get('btapp').connect_remote(username, password);
            req.then(function(res) {
                log('connect_remote', res);
            }, function(res) {
                log('connect_remote', res);
            });
        },
        onRemoteStatus: function(status) {
            log('onRemoteStatus', status);
        }
    })

    var UserView = Backbone.View.extend({
        initialize: function() {
            this.template = _.template($(this.options.templateid).html());
            this.bundles = this.createListView();
            this.model.on('change:status', this.onStatus, this);
        },
        onStatus: function(status) {
            this.$('.status').removeClass('connecting online offline error').addClass(this.model.get('status'));
        },
        assign : function (view, selector) {
            view.setElement(this.$(selector)).render();
        },
        render: function() {
            this.$el.html(this.template(this.model.toJSON()));
            this.assign(this.bundles, '.bundles');
            return this;
        }
    });

    var FriendView = UserView.extend({
        createListView: function() {
            return new FriendBundleListView({
                model: this.model.get('btapp'),
                local: this.model.get('local')
            });
        }
    });

    var SelfView = UserView.extend({
        bundleListView: SelfBundleListView,
        events: {
            'click a.fileshare': 'onShare'
        },
        createListView: function() {
            return new SelfBundleListView({
                model: this.model.get('btapp')
            });
        },
        onShare: function() {
            this.model.get('btapp').get('os').browse_for_files(_.bind(this.onFiles, this));
        },
        onFiles: function(files) {
            if(files.length === 0) {
                return 0;
            }
            files = _.map(files, function(info) {
                return {
                    handle: info.handle,
                    name: getFileName(info.path),
                    size: isDirectory(info.path) ? '~' : bytesToSize(info.size)
                };
            });
            var bundle = new ShareBundle({
                files: files,
                btapp: this.model.get('btapp'),
                name: this.model.get('name')
            });
            var bundleView = new ShareBundleDialog({
                model: bundle
            });
        }
    });

    window.beamitover = {
        Friend: Friend,
        Self: Self,
        FriendView: FriendView,
        SelfView: SelfView,
        BundleView: BundleView,
        BundleListView: BundleListView,
        FileView: FileView,
        FileListView: FileListView
    }

    $(function(){
        $('#sendRequest').click(function() {
            FB.ui(
                {
                    method  : 'apprequests',
                    message : $(this).attr('data-message')
                },
                function (response) {
                // If response is null the user canceled the dialog
                    if (response != null) {
                        log(response);
                    }
                }
            );
        });
    });

});