gitdeps
=======

gitdeps is a fairly experimental script for managing git submodules in a
declarative fashion. It's somewhat of an alternative to dependency management
tools like npm or Maven which require dependencies to have a specific structure
(package.json/pom.xml). gitdeps does not trace dependencies, but it will pull
any valid git repositories regardless of structure and store them as standard
git submodules. Because of this, consumers of a project using gitdeps need not
use gitdeps themselves and can initialize the submodules via the usual `git
submodule update --init`.


.gitdeps file
-------------

.gitdeps is a JSON file in the root of your repository. It looks like this:

```js
[
	{
		//submodule will be stored as externals/<name>
		"name": "amd-utils",
		//url to the git repo
		"url": "git://github.com/millermedeiros/amd-utils.git",
		//a "commit-ish" tag, branch, or hash. defaults to "master"
		"commit": "v0.10.0",
		//(optional) array of symbolic links to create, with
		//target = externals/<name>
		"symlinks": [
			{
				//(optional) directory under the repository's root.
				//created symlink's target will be externals/<name>/<target>
				"target": "src",
				//directory and link_name of symlink
				"link": "src/lib/amd-utils"
			}
		]
	},
	{
		"name": "dojo",
		"url": "git://github.com/dojo/dojo.git",
		"commit": "1.8.2",
		"symlinks": [
			{
				"link": "src/lib/dojo"
			}
		]
	},
	{
		"name": "deferreds.js",
		"url": "git://github.com/zship/deferreds.js.git",
		"symlinks": [
			{
				"link": "src/lib/deferreds"
			}
		]
	}
]
```

Running `gitdeps` in a git repository's root will:

1. Remove submodules not referenced in .gitdeps
2. Add submodules referenced in .gitdeps but not existing in the repository
3. Update all submodules' HEADs to point to the "commit" specified in .gitdeps
4. Clean up orphaned symlinks from previous runs
