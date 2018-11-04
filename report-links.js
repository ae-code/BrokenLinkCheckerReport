const blc = require('broken-link-checker');

var chalk = require("chalk");
var humanizeDuration = require("humanize-duration");
var spinner = require("char-spinner");
var userAgent = require("default-user-agent");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

process.on("unhandledRejection", function(reason, p) {
	log( nopter.error.fatal("Unhandled Rejection", reason, "Error") );
	process.exit(1);
});

const csvWriter = createCsvWriter({
    path: 'broken-links.csv',
    header: [
        {id: 'page', title: 'page'},
        {id: 'url', title: 'url'},
	{id: 'status', title: 'status'},
	{id: 'text', title: 'text'}
    ]
});
 

console.log("Starting...");
console.log("URL: " + process.argv[process.argv.length-1]);

run(process.argv[process.argv.length-1], {
	excludedKeywords:       [],
	excludeExternalLinks:   false,
	excludeInternalLinks:   false,
	excludeLinksToSamePage: true,
	filterLevel:            1,
	honorRobotExclusions:   true,
	maxSockets:             Infinity,
	maxSocketsPerHost:      1,
	requestMethod:          "head",
	userAgent:              userAgent("blc2","1.0"),
	cacheExpiryTime: 	(3600000 * 10)
},
{
	recursive: true,
	maintainLinkOrder: false,
	excludeCachedLinks: true,
	excludeFilteredLinks: true
});

function log()
{
	// Avoid spinner chars getting stuck in the log
	spinner.clear();
	
	console.log.apply(null, arguments);
}



function logMetrics(brokenLinks, excludedLinks, totalLinks, duration, preBreak, exit)
{
	var output = preBreak===true ? "\n" : "";
	
	output += chalk.gray("Finished! "+totalLinks+" links found.");
	
	if (excludedLinks > 0)
	{
		output += chalk.gray(" "+excludedLinks+" excluded.");
	}
	
	if (totalLinks > 0)
	{
		output += chalk.gray(" ");
		output += chalk[ brokenLinks>0 ? "red" : "green" ](brokenLinks+" broken");
		output += chalk.gray(".");
	}
	
	if (duration != null)
	{
		output += chalk.gray("\nElapsed time: ");
		output += chalk.gray( humanizeDuration(duration, {round:true, largest:2}) );
	}
	
	log(output);

	if (exit === true)
	{
		process.exit(brokenLinks===0 ? 0 : 1);
	}
}



/*
	Ensure that `logMetrics()` is called after `logResults_delayed()`.
*/
function logMetrics_delayed(brokenLinks, excludedLinks, totalLinks, duration, preBreak, exit)
{
	setImmediate( function()
	{
		logMetrics(brokenLinks, excludedLinks, totalLinks, duration, preBreak, exit);
	});
}


let currPage = "";
function logPage(data, pageUrl)
{
	var output = "";
	
	if (++data.total.pages > 1) output += "\n";
	
	currPage = pageUrl;
	output += chalk.white("Getting links from: ") + chalk.yellow(pageUrl);
	
	log(output);
}



function logResult(result, finalResult)
{
	var output = "";
	
	if (result.__cli_excluded !== true)
	{
		// TODO :: if later results are skipped, the last RENDERED result will not be "└─"
		output = chalk.gray( finalResult!==true ? "├─" : "└─" );
		
		if (result.broken === true)
		{
			output += chalk.red("BROKEN");
			output += chalk.gray("─ ");

			const record = {
				page: currPage,
				url: (result.url.resolved != null) ? result.url.resolved: result.url.original,
				status: result.brokenReason,
				text: result.html.text
			};
			csvWriter.writeRecords([record]);
		}
		else if (result.excluded === true)
		{
			output += chalk.gray("─SKIP── ");
		}
		else
		{
			output += chalk.gray("──");
			output += chalk.green("OK");
			output += chalk.gray("─── ");
		}
		
		if (result.url.resolved != null)
		{
			output += chalk.yellow( result.url.resolved );
		}
		else
		{
			// Excluded scheme
			output += chalk.yellow( result.url.original );
		}
		
		if (result.broken === true)
		{
			output += chalk.gray(" ("+ result.brokenReason +")");
		}
		else if (result.excluded === true)
		{
			output += chalk.gray(" ("+ result.excludedReason +")");
		}
		// Don't display cached message if broken/excluded message is displayed
		else if (result.http.cached === true)
		{
			output += chalk.gray(" (CACHED)");
		}
	}
	
	return output;
}



/*
	Logs links in the order that they are found in their containing HTML
	document, even if later links receive an earlier response.
*/
function logResults(data)
{
	var done,output,result;
	var nextIsReady = true;
	
	while (nextIsReady)
	{
		result = data.page.results[data.page.currentIndex];
		
		if (result !== undefined)
		{
			done = data.page.done===true && data.page.currentIndex>=data.page.results.length-1;
			
			output = logResult(result, done);
			
			if (output !== "") log(output);
			if (done === true) return;
			
			data.page.currentIndex++;
		}
		else
		{
			nextIsReady = false;
		}
	}
}



/*
	Ensure that `logResults()` is called after `data.page.done=true`.
*/
function logResults_delayed(data)
{
	// Avoid more than one delay via multiple synchronous iterations
	if (data.delay === null)
	{
		data.delay = setImmediate( function()
		{
			logResults(data);
			data.delay = null;
		});
	}
}



function pushResult(data, result, options)
{
	if (options.maintainLinkOrder === true)
	{
		data.page.results[result.html.index] = result;
	}
	else
	{
		data.page.results.push(result);
	}
}



function resetPageData(data)
{
	data.page.brokenLinks = 0;
	data.page.currentIndex = 0;
	data.page.done = false;
	data.page.excludedLinks = 0;
	data.page.results = [];
	//data.page.startTime = Date.now();
	data.page.totalLinks = 0;
}



function run(url, checkerOptions, logOptions)
{
	var handlers,instance;
	var data = 
	{
		delay: null,
		page: {},
		total:
		{
			brokenLinks: 0,
			excludedLinks: 0,
			links: 0,
			pages: 0,
			startTime: Date.now()
		}
	};
	
	// In case first page doesn't call "html" handler
	resetPageData(data);
	
	handlers =  
	{
		html: function(tree, robots, response, pageUrl)
		{
			resetPageData(data);
			
			logPage(data, pageUrl);
		},
		junk: function(result)
		{
			if (logOptions.excludeFilteredLinks === true)
			{
				result.__cli_excluded = true;
				
				data.page.excludedLinks++;
				data.total.excludedLinks++;
			}
			
			data.page.totalLinks++;
			data.total.links++;
			
			pushResult(data, result, logOptions);
			
			logResults_delayed(data);
		},
		link: function(result)
		{
			// Exclude cached links only if not broken
			if (result.broken===false && result.http.cached===true && logOptions.excludeCachedLinks===true)
			{
				result.__cli_excluded = true;
				
				data.page.excludedLinks++;
				data.total.excludedLinks++;
			}
			else if (result.broken === true)
			{
				data.page.brokenLinks++;
				data.total.brokenLinks++;
			}
			
			data.page.totalLinks++;
			data.total.links++;
			
			pushResult(data, result, logOptions);
			
			logResults_delayed(data);
		},
		page: function(error, pageUrl)
		{
			if (error != null)
			{
				// "html" handler will not have been called
				logPage(data, pageUrl);
				
				log( chalk[ error.code!==200 ? "red" : "gray" ](error.name+": "+error.message) );
			}
			else
			{
				data.page.done = true;
				
				logMetrics_delayed(data.page.brokenLinks, data.page.excludedLinks, data.page.totalLinks);
			}
		},
		end: function()
		{
			if (data.total.pages <= 0)
			{
				process.exit(1);
			}
			else if (data.total.pages === 1)
			{
				process.exit(data.page.done===true && data.total.brokenLinks===0 ? 0 : 1);
			}
			else if (data.total.pages > 1)
			{
				logMetrics_delayed(data.total.brokenLinks, data.total.excludedLinks, data.total.links, Date.now()-data.total.startTime, true, true);
			}
		}
	};
	
	if (logOptions.recursive !== true)
	{
		instance = new blc.HtmlUrlChecker(checkerOptions, handlers);
	}
	else
	{
		instance = new blc.SiteChecker(checkerOptions, handlers);
	}
	
	spinner();
	
	instance.enqueue(url);
}

