'use strict';


var fs = require('fs');
var path = require('path');

var Deferred = require('../lib/deferreds.js').Deferred;
var Deferreds = require('../lib/deferreds.js').Deferreds;
var util = require('../lib/util.js');
//var longjohn = require('longjohn');
//longjohn.async_trace_limit = 20;  // defaults to 10


var globals;


module.exports.cli = function() {

	Deferreds.pipe([

		function() {
			var repoRoot = util.findup(process.cwd(), '.git');

			if (!repoRoot) {
				return Deferred().reject('No git repository found at current path or parents.');
			}

			repoRoot = path.resolve(repoRoot, '..');

			globals = {
				root: repoRoot,
				extdir: path.join(repoRoot, 'externals')
			};

			process.chdir(globals.root);

			var config = path.join(repoRoot, '.gitdeps');

			if (!fs.existsSync(config)) {
				return Deferred().reject('No .gitdeps file found for repository at ' + globals.root);
			}

			try {
				globals.config = JSON.parse(fs.readFileSync(config, 'utf-8'));
			}
			catch(e) {
				console.error('Could not parse ' + config);
				throw e;
			}
		},


		//get summary info for all submodules under repo
		function() {
			return util.submodules.get(globals.root);
		},


		//then combine with .getdeps config
		function(submodules) {
			//console.log(JSON.stringify(submodules, false, 4));
			var target = submodules;
			var source = globals.config;

			var result = {
				update: [],
				create: [],
				remove: []
			};

			source.forEach(function(submod) {
				submod.commit = submod.commit || 'master';

				var ideal = path.join(globals.extdir, submod.name);

				var match;
				target.every(function(tgt) {
					var actual = path.join(globals.root, tgt.dir);
					if (ideal === actual) {
						match = tgt;
						return false;
					}
					return true;
				});

				if (match) {
					result.update.push({
						name: submod.name,
						url: match.url,
						prev: match.head,
						commit: submod.commit,
						next: submod.commit,
						dir: match.dir,
						symlinks: submod.symlinks
					});
				}
				else {
					result.create.push({
						name: submod.name,
						url: submod.url,
						commit: submod.commit,
						next: submod.commit,
						dir: path.relative(globals.root, globals.extdir) + '/' + submod.name,
						symlinks: submod.symlinks
					});
				}
			});

			target.forEach(function(tgt) {
				var match;
				var actual = path.join(globals.root, tgt.dir);

				source.every(function(submod) {
					var ideal = path.join(globals.extdir, submod.name);
					if (ideal === actual) {
						match = tgt;
						return false;
					}
					return true;
				});

				if (!match) {
					result.remove.push({
						url: tgt.url,
						dir: tgt.dir
					});
				}
			});

			return result;
		},


		//determine if submodules marked to be updated actually have the same
		//"prev" and "next" commits (due to possibly using a tag name in .gitdeps,
		//while git reports a sha hash)
		function(submodules) {
			//console.log(JSON.stringify(submodules, false, 4));

			return Deferreds
				.chain(submodules.update)
				.mapSeries(function(submod) {
					var deferred = new Deferred();
					var dir = path.join(globals.root, submod.dir);

					util.isBranch(dir, submod.next).then(function(isBranch) {
						//always pull from remote if a branch was requested
						if (isBranch) {
							console.log(dir + ': ' + submod.next + ' is a branch. pulling from remote to see if there are updates.');
							util.recursivePull(dir).then(function() {
								//console.log('rpull done');
								util.commitish(dir, submod.next).then(function(commit) {
									//console.log('found commit ' + commit);
									submod.next = commit;
									deferred.resolve(submod);
								}).fail(function(err) {
									throw err;
								});
							}).fail(function(err) {
								throw err;
							});

							return;
						}

						//console.log(dir + ': ' + submod.next + ' is a hash or tag');

						util.commitish(dir, submod.next).then(function(commit) {
							//console.log('found commit ' + commit);
							submod.next = commit;
							deferred.resolve(submod);
						}).fail(function() {

							//console.log(dir + ': ' + submod.next + ' not found. pulling.');
							//requested commit not found. try pulling all remotes and try
							//again.
							util.recursivePull(dir).then(function() {
								util.commitish(dir, submod.next).then(function(commit) {
									submod.next = commit;
									deferred.resolve(submod);
								}).fail(function(err) {
									throw err;
								});
							}).fail(function(err) {
								throw err;
							});
						});
					});

					return deferred.promise();
				})
				.filter(function(submod) {
					return !!submod.next;
				})
				.pipe(function(result) {
					submodules.update = result;

					return {
						update: submodules.update,
						create: submodules.create,
						remove: submodules.remove
					};
				});

		},


		//split out "update" submodules which have no difference between their prev
		//and next commit
		function(submodules) {
			var result = {
				stay: [],
				update: [],
				create: submodules.create,
				remove: submodules.remove
			};

			submodules.update.forEach(function(submod) {
				if (submod.prev === submod.next) {
					result.stay.push(submod);
				}
				else {
					result.update.push(submod);
				}
			});

			return result;
		},


		function(submodules) {
			console.log(JSON.stringify(submodules, false, 4));

			return Deferreds.series(
				function() {
					return Deferreds.forEachSeries(submodules.remove, function(submod) {
						console.log('Removing ' + submod.dir + '...');
						return util.submodules.remove(globals, submod);
					});
				},

				function() {
					return Deferreds.forEachSeries(submodules.create, function(submod) {
						console.log('Adding ' + submod.name + ' at ' + path.join(globals.extdir, submod.name) + '...');
						return util.submodules.add(globals, submod);
					});
				},

				function() {
					return Deferreds.forEachSeries(submodules.update, function(submod) {
						console.log('Updating ' + submod.name + ' to ' + submod.commit + ' (' + submod.next.slice(0, 6) + ')...');
						return util.submodules.update(globals, submod);
					});
				}
			).pipe(function() {
				return submodules;
			});
		},


		//check all symlinks
		function(submodules) {
			var linkModules = submodules.stay.concat(submodules.update).concat(submodules.create);
			linkModules.forEach(function(submod) {
				if (!submod.symlinks || !submod.symlinks.length) {
					return;
				}

				submod.symlinks.forEach(function(link) {
					var src = path.join(globals.root, link.link);
					var srcDir = path.dirname(src);
					var absoluteDest = path.join(globals.extdir, submod.name);
					if (link.target) {
						absoluteDest = path.join(absoluteDest, link.target);
					}
					var dest = path.relative(srcDir, absoluteDest);

					console.log('Making symlink from ' + src + ' -> ' + dest);

					if (fs.existsSync(src)) {
						//if there's already a symbolic link there, update it (assume we made it)
						if (fs.lstatSync(src).isSymbolicLink()) {
							fs.unlinkSync(src);
						}
						else {
							console.error('Cannot make symlink: file already exists at ' + src);
						}
					}

					if (!fs.existsSync(src)) {
						process.chdir(srcDir);
						fs.symlinkSync(dest, path.basename(src));
					}
				});
			});

			process.chdir(globals.root);

			//delete broken symlinks
			util.cmd('find . -type l ! -exec test -e {} \\; -exec rm {} \\;', globals.root).then(function(stdout) {
				if (stdout.trim()) {
					console.log('Removed broken symlinks:');
					console.log(stdout);
				}
			});
		}

	]).fail(function(err) {
		console.error('ERROR');
		console.error(err);
	});

};
