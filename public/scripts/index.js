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
    var ret = new jQuery.Deferred();
    FB.ui(
        {
            method      : 'send',
            link        : 'http://apps.facebook.com/' + $("meta[property='og:namespace']").attr("content"),
            description : description
        },
        function (response) {
        // If response is null the user canceled the dialog
            if (response != null) {
                ret.resolve();
            } else {
                ret.reject();
            }
        }
    );
    return ret;
}

function inviteFB(message) {
    var ret = new jQuery.Deferred();
    FB.ui(
        {
            method  : 'apprequests',
            message : message
        },
        function (response) {
        // If response is null the user canceled the dialog
            if (response != null) {
                ret.resolve();
            } else {
                ret.reject();
            }
        }
    );
    return ret;
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
            this.template = _.template($(this.templateSelector).html());
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
        templateSelector: '#self_bundle_template',
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
            if(this.$('.share').hasClass('disabled')) {
                return;
            }

            this.$('.share').addClass('disabled');
            var length = this.model.get('file').length;
            var name = this.model.get('properties').get('name');
            var msg = 'Sharing a ' + length + ' file bundle: ' + name;
            var req = sendFB(msg);
            var reEnable = _.bind(function() {
                this.$('.share').removeClass('disabled');
            }, this);
            req.then(reEnable, reEnable);
        },
        onOpen: function() {
            if(this.$('.open').hasClass('disabled')) {
                return;
            }
            this.$('.open').addClass('disabled');
            var reEnable = _.bind(function() {
                this.$('.open').removeClass('disabled');
            }, this);
            this.model.open_containing();
            setTimeout(reEnable, 2000);
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
     *  FriendBundleView
     *  
     *  This view is responsible for providing the UI for a torrent on a friends machine
     *  It should enable you to download the torrent they have onto your own machine,
     *  as well as reflect the state change when you begin downloading it
    **/
    var FriendBundleView = BundleView.extend({
        templateSelector: '#friend_bundle_template',
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
                this.$('.btn').addClass('disabled');
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
            this.$el.prepend(view.render().el);
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

    var FriendView = Backbone.View.extend({
        initialize: function() {
            this.template = _.template($(this.options.templateid).html());
            this.bundles = new FriendBundleListView({
                model: this.model.get('btapp'),
                local: this.model.get('local')
            });
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

    /**
     *  Bundling
     *
     *  Keeps the state of a torrent generation "session"...from
     *  the time that the user selects files, we need to store state
     *  about how we will create the torrent
    **/
    var Bundling = Backbone.Model.extend({
        defaults: {
            progress: 0,
            files: [],
            status: 'Warming up...'
        },
        initialize: function() {
            _.bindAll(this, 'onSuccess', 'onError', 'onProgress', 'onBundleRequestSuccess', 'onBundleRequestFailure');
        },
        bundle: function() {
            if(this.get('files').length === 0) {
                this.done();
                return;
            }
            var req = this.get('btapp').get('torrent').generate({
                files: _(this.get('files')).pluck('handle'),
                callback: this.onSuccess,
                error: this.onError,
                progress: this.onProgress
            });
            req.then(this.onBundleRequestSuccess, this.onBundleRequestFailure);
        },
        onSuccess: function() {
            log('onSuccess');
            this.set({
                progress: 100,
                status: 'Success! Now sharing files.'
            });
            this.done();
        },
        onError: function() {
            log('onError');
            this.set({
                status: 'Horrible failure!'
            });
            this.done();
        },
        onProgress: function(progress) {
            log('onProgress - ' + progress);
            this.set({
                progress: progress,
                status: 'Bunding...'
            });
        },
        onBundleRequestSuccess: function() {
            log('onBundleRequestSuccess');
            this.set('status', 'Bundling requested.');
        },
        onBundleRequestFailure: function() {
            log('onBundleRequestFailure');
            this.set('status', 'Horrible failure!');
            this.done();
        },
        done: function() {
            this.collection.remove(this);
            this.trigger('destroy');
        }
    });

    var BundlingView = Backbone.View.extend({
        templateSelector: '#bundling_template',
        className: 'bundle row well',
        initialize: function() {
            this.template = _.template($(this.templateSelector).html());
            this.model.on('change', this.render, this);
            this.model.get('btapp').get('os').browse_for_files(_.bind(this.onFiles, this));
            this.model.on('destroy', this.onDestroy, this);
        },
        onDestroy: function() {
            this.model.off('change', this.render, this);
            this.model.off('destroy', this.onDestroy, this);
            this.unbind();
            this.$el.fadeOut('slow', _.bind(function() {
                this.remove();
            }, this));
        },
        onFiles: function(files) {
            var friendly = _.map(files, function(info) {
                return {
                    handle: info.handle,
                    name: getFileName(info.path),
                    size: isDirectory(info.path) ? '~' : bytesToSize(info.size)
                };
            });
            this.model.set({
                files: friendly
            });
            this.model.bundle();
        },
        render: function() {
            this.$el.html(this.template(this.model.toJSON()));
            return this;
        }
    })

    var BundlingList = Backbone.Collection.extend({});

    var BundlingListView = Backbone.View.extend({
        initialize: function() {
            this.model.on('add', this.onAdd, this);
        },
        onAdd: function(model) {
            var view = new BundlingView({
                model: model
            });
            this.$el.append(view.render().el);
        }
    });

    var SelfView = Backbone.View.extend({
        bundleListView: SelfBundleListView,
        events: {
            'click a.fileshare': 'onShare'
        },
        initialize: function() {
            this.template = _.template($(this.options.templateid).html());
            this.bundles = new SelfBundleListView({
                model: this.model.get('btapp')
            });
            
            this.bundlings = new BundlingListView({
                model: new BundlingList(),
                btapp: this.model.get('btapp')
            });
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
            this.assign(this.bundlings, '.bundlings');
            return this;
        },
        onShare: function() {
            this.bundlings.model.add(new Bundling({
                btapp: this.model.get('btapp')
            }));
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
            inviteFB($(this).attr('data-message'));
        });
    });

});