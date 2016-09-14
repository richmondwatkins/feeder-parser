(function() {
	var cheerio = require('cheerio'),
		Entities = require('html-entities').AllHtmlEntities,
		sanitizeHtml = require('sanitize-html'),
		splitHtml = require('split-html'),
		moment = require('moment'),
		async = require('async'),
		entities = require('entities'),
		Class = require('root-class'),
		request = require('request'),
		url = require('url'),
		URI = require('./uri'),
		FIXES = require('./fixes'),
		parseTo$ = function(text) {
			return cheerio.load(text, {
				xmlMode: true,
				lowerCaseTags: true
			});
		},
		parseRoot = function(text, $) {
			return $.root().children().first();
		};

	var RSSParser = Class.extend({
		initialize: function(feed) {

			this.feed = feed;
			this.path = feed.path;

			this.maxPostsPerFeed = 250;

			this.error = false;
			this.posts = [];
			this.data = {};

			this.fixes = FIXES[this.path] || {};

			this.rootElement = false;
		},

		setResult: function(text, callback) {
			callback = typeof callback === 'function' ? callback : function() {};

			if (!text) {
				this.error = true;
				callback();
				return;
			}

			text = RSSParser.trimChars(text);

			try {
				this.$ = parseTo$(text);
				this.rootElement = parseRoot(text, this.$);
			} catch (e) {
			 	this.rootElement = false;
			}

			if (! this.rootElement) {
				this.error = true;
				this.errorMessage = 'no root element';
				callback();
				return;
			}

			callback();
		},

		parse: function(callback) {
			var allSamePublished = true,
				prevPost;

			callback = typeof callback === 'function' ? callback : function() {};

			try {
				this._parse(callback);

				this.posts.forEach(function(post) {
					if (prevPost &&
						! (
							prevPost.published_from_feed &&
							post.published_from_feed &&
							post.published_from_feed === prevPost.published_from_feed
						)
					) {
						allSamePublished = false;
					}
					prevPost = post;
				});

				if (allSamePublished) {
					this.feedHasBrokenPublishedDate();
				}
			} catch(e) {
				this.error = true;
				this.errorMessage = 'could not parse: ' + e.message;
				this.errorException = e;
				callback(this);
			}
		},

		checkFeedType: function() {
			if (this.path.includes('youtube') || this.path.includes('y2u.be')) {
				return 'youtube';
			} else {
				return 'blog';
			}
		},

		_parse: function(callback) {

			this.currentCallback = callback;
			var rootElement = this.rootElement;

			if (this.error) {
				this.currentCallback(this);
				return;
			}

			// Test for RSS
			var type = false;

			if (rootElement.is('rss, rdf, rdf\\:rdf')) {
				type = 'rss';
			} else if (rootElement.is('feed')) {
				type = 'atom';
			}

			if (! type) {
				this.error = true;
				this.errorMessage = 'not compatible ' + rootTag;
				this.currentCallback(this);
				return;
			}

			try {
				switch (type) {
					case 'rss':
						this.parseRSSResponse(rootElement);
						break;

					case 'atom':
						this.parseAtomResponse(rootElement);
						break;
				}

				this.feed.title = this.data.title;
				this.feed.link = this.data.link;

				// console.log('============ parse =======');
                //
				// this.posts.forEach(function (post) {
				// 	if (! post.image.url) {
				// 		console.log('hit');
				// 		console.log(post.link);
				// 	}
				// });
				console.log('+++++++++++++++++++++');
				this.scrapeImageFromUrlsIfNeeded(function () {
					console.log('========_________========');
					this.currentCallback(this);
				});
			} catch (e) {
				this.error = true;
				this.errorMessage = 'could not parse ' + type + ': ' + e.message;
				this.errorException = e;
				this.currentCallback(this);
			}
		},

		scrapeImageFromUrlsIfNeeded: function (posts, callback) {
			var scope = this;
			if (!posts || posts.length == 0) {
				callback(posts);
				return;
			}

			async.each(posts, function(post, fn) {
				if ((! post.image || ! post.image.url) && post.url && ! post.url.includes('.mp3')) {
					request({
						url: post.url,
						headers: {
							'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
							'Cache-Control': 'no-cache',
							'Domain': 'bravi.co',
							'Upgrade-Insecure-Requests': 1,
							'User-Agent': 'request'
						},
						timeout: 10 * 1000
					}, function(err, res, html) {
						console.log(post.url);
						var $ = null;
						try {
							$ = cheerio.load(html);
						} catch (ex) {
							console.log(ex);
							fn();
							return
						}

						var reqUrl = url.parse(post.url),
						imgs = $('img');

						var cleanedImages = [];

						for (var i = 0; i <= imgs.length; i++) {
							var src = $(imgs[i]).attr('src');

							if (src && scope.imageUrlIsClean(src)) {
								if (! src.includes('http') && ! src.includes('https')) {
									src = src.replace('//', '');
								}

								var srcUrl = url.parse(src);

								if (!srcUrl.host) {
									src = url.resolve(reqUrl, srcUrl);
								} else {
									src = url.format(srcUrl);
								}

								console.log('+++++++++++++++++++++ SRC ++++++++++++++++++++');
								console.log(src);
								cleanedImages.push(src);
							}
						}

						if (cleanedImages.length >= 5) {
							post.image = cleanedImages[Math.floor(cleanedImages.length * .25)];
						}  else if (cleanedImages.length < 5 && cleanedImages.length >= 2) {
							post.image = cleanedImages[1];
						} else if (cleanedImages.length == 1) {
							post.image = cleanedImages[0];
						}

						fn();
					});
				} else {
					fn();
				}
			}, function(err) {
				if( err ) {
					// One of the iterations produced an error.
					// All processing will now stop.
					console.log('A file failed to process');
				} else {
					console.log('All files have been processed successfully');
				}

				callback(posts);
			});
		},

		imageUrlIsClean: function (url) {
			var subStrings = [
				'.gif',
				'wrench',
				'creativecommons',
				'digg',
				'technorati',
				'delicious',
				'mail',
				'.svg',
				'reddit',
				'yahoo',
				'stumbleupon',
				'data:image',
				'avatar',
				'icon',
				'subscribe',
				'widgets',
				'facebook',
				'twitter',
				'instagram',
				'pinterest',
				'gravatar',
				'google',
				'bloglovin'
			],
				length = subStrings.length;

			while(length--) {
				if (url.indexOf(subStrings[length])!= -1) {
					return false;
				}
			}

			return true
		},

		parseRSSResponse: function(rootElement) {
			var entities = new Entities();

			// Get link, use this contraption because some feeds mix atom:link to be compatible with atom
			// Or something weird
			var link;
			var links = [].slice.call(rootElement.find('link')).filter(function(el) {
				return el.parent != rootElement[0];
			});

			for (var i = 0, l; l = links[i]; i++) {
				l = this.$(l);
				if (! l.is('atom')) {
					link = RSSParser.cleanData(l.text());
					break;
				// Fix for weird 'atom10' format, see: feedsfeedburnercomimgurgallery?format=xml
				} else if (l.is('atom10')) {
					link = l.attr('href');
					break;
				}
			}

			if (! link) {
				link = this.path;
			}

			this.data.link = link;
			this.path = link;

			this.data.favicon = 'chrome://favicon/' + this.getDomain(this.data.link);

			var titleEl = rootElement.find('title').first();
			this.data.title = RSSParser.trimChars(titleEl.text());

			var posts = rootElement.find('item,channel');
			for (var i = 0, post; (post = posts[i]) && i < 50; i++) {
				post = this.$(post);

				var titleElement = post.find('title').first();
				var linkElements = post.find('link, guid[isPermaLink]:not([isPermaLink="false"])');
				var guidElement = this.getGuid(post);
				if (!linkElements.length) {
					if (guidElement.text().match(/^http:\/\//))
						linkElements = guidElement;
				}

				if (! titleElement.length || ! linkElements.length)
					if (!guidElement.length)
						continue;

				// Fulhax for itunes feeds
				var enclosureElement = post.find('enclosure');
				var podcastURL = enclosureElement.length ? enclosureElement.attr('url') : false;
				var fallbackElement = podcastURL ? podcastURL : false;
				// end fulhax

				var link;
				if (linkElements.length)
					link = this.parsePostLink(linkElements);
				else
					link = fallbackElement;
				if (! link)
					continue;
				
				var content = post.find('content,content\\:encoded').text(),
					description = post.find('description').text(),
					author = post.find('dc\\:creator,creator').text();

				var $ = cheerio.load(content.trim()),
					img = this.getImage($('img').first()),
					props = {
						title: titleElement.text() || link,
						url: this.resolveURL(link),
						published_at: this.getDate(post),
						guid: guidElement.text() || '',

						// Strip out html tags and decode html entities
						description: entities.decode(
							sanitizeHtml(description, {
								allowedTags: [],
								allowedAttributes: []
							})
						),
						author: author
					};

				if (img.url) {
					props.image = img;
				}

				if (content && content !== '') {
					$('.feedflare').remove();
					var decoded = entities.decode($.html());  // Decode html entities
					var split = splitHtml(decoded, 'div');

					if (split.length) {
						if (split.length == 1) {
							split.push('<ad></ad>')
						} else {
							split.splice(split.length / 2, 0, '<ad></ad>');
						}
					}

					props.content = split.join(' ');
				}

				this.foundPost(props);
			}
		},

		parseAtomResponse: function(rootElement) {
			var titleEl = rootElement.find('title').first();

			this.data.link = this.parseLink(rootElement);
			this.data.title = RSSParser.trimChars(titleEl.length ? titleEl.text() : this.data.link);
			this.data.favicon = 'chrome://favicon/' + this.getDomain(this.data.link);

			this.path = this.data.link;

			var posts = rootElement.find('entry');
			for (var i = 0, post; (post = posts[i]); i++) {
				post = this.$(post);

				var titleElement = post.find('title').first();
				var linkElements = post.find('link');
				var guidElement = this.getGuid(post);

				if (! titleElement.length || ! linkElements.length)
					continue;

				var link = this.parsePostLink(linkElements);

				var content = post.find('content,content\\:encoded').text(),
					author = post.find('author').text(),
					description = post.find('summary').text();

				var $ = cheerio.load(content.trim()),
					img = this.getImage($('img').first()),
					props = {
						title: titleElement.text() || link,
						url: this.resolveURL(link),
						published_at: this.getDate(post),
						guid: guidElement.text() || '',

						// Strip out html tags and decode html entities
						description: entities.decode(
							sanitizeHtml(description, {
								allowedTags: [],
								allowedAttributes: []
							})
						),
						author: author
					};

				if (img.url) {
					props.image = img;
				}

				if (content && content !== '') {

					$('.feedflare').remove();
					var decoded = entities.decode($.html());  // Decode html entities
					var split = splitHtml(decoded, 'div');

					if (split.length) {
						if (split.length == 1) {
							split.push('<ad></ad>')
						} else {
							split.splice(split.length / 2, 0, '<ad></ad>');
						}
					}

					props.content = split.join('');
				}

				this.foundPost(props);
			}
		},

		getImage: function($img) {
			if (! $img) {
				return {};
			}

			return {
				url: $img.attr('src')
			};
		},

		parseLink: function(rootElement) {
			var links = rootElement.find('link');
			var $ = this.$;

			// Find link
			links = links.filter(function(index, l) {
				return ! RSSParser.matchTag($(l), 'entry');
			}).toArray();

			// Sort after which one is most relevant
			// empty rel is a good thing, otherwise what should it be?
			links = links.sort(function(a, b) {
				return !$(a).attr('rel') ? -1 : 1;
			});

			if (!links[0])
				return '';

			return RSSParser.resolveFrom(links[0], $(links[0]).attr('href'));
		},

		resolveURL: function(link) {
			if (/http?:\/\//.test(link)) {
				return link;
			}

			var linkURI = new URI(link);

			if (! linkURI.protocol()) {
				var uri = new URI(link, this.path);

				uri.protocol('http');

				return uri.toString();
			}

			return link;
		},

		parsePostLink: function(links) {
			var $ = this.$;

			links = links.toArray().sort(function(a, b) {
				var ap = pointsForObject($(a));
				var bp = pointsForObject($(b));
				if (ap == bp)
					return 0;
				return ap > bp ? -1 : 1;
			});
			var link = links[0];
			if (!link)
				return false;

			link = this.$(link);

			var href = link.attr('href') || link.text();
			return RSSParser.resolveFrom(link, href);

			function pointsForObject(a) {
				if (a.attr('isPermaLink') === 'false')
					return -10;
				var rel = a.attr('rel');
				var type = a.attr('type');
				var points = -1;
				if (rel == 'alternate')
					points += 2;
				if (type == 'text/html')
					points += 2;
				return points;
			}
		},

		getGuid: function(post) {
			return post.find('guid, id').first();
		},

		getDate: function(post) {
			var datePublished = post.find('published, updated, pubDate, dc\\:date, date, created, issued').first();

			var date;
			if (datePublished.text()) {
				var txtDate = datePublished.text();
				return moment(txtDate).utc();
			}

			if (! date || date === 'Invalid Date' || isNaN(date.getTime())) {
				date = null;
			} else {
				date = date.getTime();
			}

			if (this.fixes.noPublished) {
				return null;
			}

			return date;
		},

		foundPost: function(data) {
			if (! data.title || ! data.url) {
				// console.log('no title or url');
				return;
			}

			data.title = entities.decode(RSSParser.trimChars(data.title));
			data.url = RSSParser.trimChars(data.url);

			// If not http or https is present, or some other weird protocol, just assume it's relative
			if (! data.url.match(/^(http|https):/) && ! data.url.match(/^[a-zA-Z0-9-]+:/)) {
				var domain = this.getDomain(this.path);
				data.url = RSSParser.trimChars(domain, '/') + data.url;
			}

			if (this.fixes.noGUID) {
				delete data.guid;
			}

			this.posts.push(data);
		},

		getDomain: function(link) {
			return RSSParser.trimChars(link.substr(0, (link.indexOf('/', link.indexOf('.')) + 1) || link.length), '/') + '/';
		},

		feedHasBrokenPublishedDate: function() {
			this.posts.forEach(function(post) {
				post.published_at = null;
				delete post.published_from_feed;
			});
		}
	});

	RSSParser.matchTag = function(el, tagName) {
		do {
			if (el.is(tagName))
				return el;
		} while ((el = el.parent()) && el.length);
		return false;
	};

	RSSParser.resolveFrom = function(ref, url) {
		var bases = [];
		var el = ref[0];
		while (el && el.attribs) {
			if (el.attribs['xml:base']) {
				bases.push(el.attribs['xml:base']);
			}

			el = el.parent;
		}

		if (! bases.length) {
			return url;
		}

		return new URI(url, bases.reduce(function(a, b) {
			return new URI(a, b).toString();
		})).toString();
	};

	RSSParser.trimChars = function(str, charlist) {
		if (!charlist) {
			return (str || '').trim();
		}

		charlist = charlist || ' \r\n\t';
	    var l = 0, i = 0;

	    var ret = str || '';

	    l = ret.length;
	    for (i = 0; i < l; i++) {
	        if (charlist.indexOf(ret.charAt(i)) === -1) {
	            ret = ret.substring(i);
	            break;
	        }
	    }

	    l = ret.length;
	    for (i = l - 1; i >= 0; i--) {
	        if (charlist.indexOf(ret.charAt(i)) === -1) {
	            ret = ret.substring(0, i + 1);
	            break;
	        }
	    }

	    return charlist.indexOf(ret.charAt(0)) === -1 ? ret : '';
	};

	RSSParser.cleanData = function(string) {
		return string.replace(/<!\[CDATA\[(.*)\]\]>/, function(a, b) { return b; }).trim();
	};

	this.RSSParser = RSSParser;

	module.exports = RSSParser;
})();