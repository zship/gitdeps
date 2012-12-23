'use strict';


var child = require("child_process");
var fs = require('fs');
var path = require('path');
// In Nodejs 0.8.0, existsSync moved from path -> fs.
var existsSync = fs.existsSync || path.existsSync;

var Deferred = require('./deferreds.js').Deferred;
var Deferreds = require('../lib/deferreds.js').Deferreds;


var cmd = function(command, cwd) {
	cwd = cwd || process.cwd();

	var deferred = new Deferred();
	child.exec(command, {cwd: cwd}, function(err, stdout) {
		if (err) {
			var message = 'Error on command: ' + command + ' (cwd: ' + cwd + ')';
			throw message + ' ' + err;
			//deferred.reject(message + ' ' + err);
		}
		else {
			deferred.resolve(stdout);
		}
	});
	return deferred.promise();
};


// Search for a filename in the given directory or all parent directories.
var findup = function(dirpath, filename) {
  var filepath = path.join(dirpath, filename);
  // Return file if found.
  if (existsSync(filepath)) { return filepath; }
  // If parentpath is the same as dirpath, we can't go any higher.
  var parentpath = path.resolve(dirpath, '..');
  return parentpath === dirpath ? null : findup(parentpath, filename);
};


//check for modified content and uncommitted changes
var isClean = function(dir) {
	return cmd('git status --porcelain', dir).pipe(function(stdout) {
		return stdout.trim().length === 0;
	});
};


//check for unpushed commits in tracking branches
var hasUnpushed = function(dir) {
	return cmd('git branch --no-color -vv 2> /dev/null', dir).pipe(function(stdout) {
		if (!stdout.trim()) {
			return false;
		}

		var lines = stdout.trim().split('\n');

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();

			var remote = line.match(/.*\[\(.*\)\]/);
			if (!remote || !remote.length) {
				continue;
			}
			remote = remote[1];

			var status = remote.match(/.*: ahead \(.*\)/);
			if (!status || !status.length) {
				continue;
			}

			return true;
		}

		return false;
	});
};


var recursivePull = function(dir) {
	return Deferred().resolve();
	//get all remote branches
	/*
	 *return cmd('git branch -r', dir).pipe(function(stdout) {
	 *    var branches = [];
	 *    var lines = stdout.trim().split('\n');
	 *    lines.forEach(function(line) {
	 *        var branch = line.trim().match(/\S+?\/(\S*)/)[1];
	 *        branches.push(branch);
	 *    });
	 *    return branches.filter(function(branch) {
	 *        return branch !== 'HEAD';
	 *    });
	 *}).pipe(function(branches) {
	 *    //pull from each one
	 *    return Deferreds.forEachSeries(branches, function(branch) {
	 *        return Deferreds.series(
	 *            cmd.bind(this, 'git checkout ' + branch, dir),
	 *            cmd.bind(this, 'git pull', dir)
	 *        );
	 *    });
	 *});
	 */
};


var isBranch = function(dir, commitish) {
	return cmd('git show-ref ' + commitish, dir).pipe(function(stdout) {
		var ref = stdout.trim().split(' ')[1].trim();
		return (
			ref.search(/refs\/heads\//) !== -1 ||
			ref.search(/refs\/remotes\//) !== -1
		);
	});
};


//resolve a "commit-ish" (tag, sha, or branch) string to a git sha1 hash
var commitish = function(dir, commit) {
	return cmd('git show-ref ' + commit, dir).pipe(function(stdout) {
		return stdout.trim().split(' ')[0].trim();
	});
};


var submodules = {};

//get summary info for all submodules under repo
submodules.get = function(repo) {
	return Deferreds
		.chain(cmd('git submodule', repo))
		.pipe(function(stdout) {
			if (stdout.trim() === '') {
				return [];
			}

			var submodules = stdout.trim().split('\n').map(function(submodule) {
				var tokens = submodule.trim().split(/\s+/);
				return {
					head: tokens[0].replace(/[^a-f0-9]/g, ''),
					dir: tokens[1]
				};
			});

			return submodules;
		})
		//remove orphaned submodules
		.filter(function(submod) {
			if (!fs.existsSync(submod.dir)) {
				return submodules.unsafeRemove({
					root: repo
				}, {
					dir: submod.dir
				}).pipe(function() {
					return false;
				});
			}
			else {
				return true;
			}
		})
		//add the remote URL
		.map(function(submod) {
			var cwd = path.join(repo, submod.dir);

			return cmd('git remote -v', cwd).pipe(function(stdout) {
				var lines = stdout.trim().split(/\n/);
				var tokens = lines[0].trim().split(/\s+/);
				var url = tokens[1];

				return {
					head: submod.head,
					dir: submod.dir,
					url: url
				};
			});
		});
};


submodules.remove = function(constants, submod) {
	var absolutePath = path.join(constants.root, submod.dir);

	return Deferreds.chain()
		.parallel(
			isClean.bind(undefined, absolutePath),
			hasUnpushed.bind(undefined, absolutePath)
		)
		.pipe(function(isClean, hasUnpushed) {
			if (!isClean) {
				throw new Error('error: ' + absolutePath + ' is not clean.');
			}
			if (hasUnpushed) {
				throw new Error('error: ' + absolutePath + ' has unpushed commits.');
			}
		})
		.pipe(function() {
			return submodules.unsafeRemove(constants, submod);
		});
};


submodules.unsafeRemove = function(constants, submod) {
	var absolutePath = path.join(constants.root, submod.dir);

	return Deferreds.series(
		cmd.bind(this, 'git config -f .gitmodules --remove-section submodule."' + submod.dir + '" 2>/dev/null', constants.root),
		cmd.bind(this, 'git config --remove-section submodule."' + submod.dir + '" 2>/dev/null', constants.root),
		cmd.bind(this, 'git rm --cached "' + submod.dir + '"', constants.root),
		cmd.bind(this, 'rm -Rf "' + absolutePath + '"', constants.root)
	);
};


submodules.add = function(constants, submod) {
	return cmd('git submodule add ' + submod.url + ' ' + submod.dir, constants.root);
};


submodules.update = function(constants, submod) {
	var cwd = path.join(constants.root, submod.dir);
	return cmd('git checkout ' + submod.next, cwd);
};


var util = {
	cmd: cmd,
	findup: findup,
	isBranch: isBranch,
	commitish: commitish,
	recursivePull: recursivePull,
	isClean: isClean,
	hasUnpushed: hasUnpushed,
	submodules: submodules
};


module.exports = util;
