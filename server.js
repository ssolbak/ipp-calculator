var express = require('express');
var app = express();
var exphbs  = require('express-handlebars');
var bodyParser = require('body-parser');

var _ = require('lodash');
var async = require("async");
var fs = require("fs");

app.engine('.hbs', exphbs({
    extname : ".hbs",
    defaultLayout: 'main.hbs',
    helpers : require("./helpers")
    //,partialsDir: "views/partials/"
}));
app.set('view engine', '.hbs');

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));

app.get('/', function (req, res) {
    getIPPData(function(err, data){
        res.render("results", { msg: err, data:data});
    });
});

app.post('/', function(req, res) {

    //console.log(req.query);
    //console.log(req.body);

    var params = req.body;

    if(!params) {
        res.render("results", {msg : "Invalid url"});
        return;
    }

    var url = params.url;

    var matches = /http:\/\/www.hockeydb.com\/ihdb\/stats\/pdisplay.php\?pid=([0-9]+)/.exec(url);

    if(!matches || matches.length < 1)
    {
        res.render("results", {msg : "Invalid url. Could not get id."});
        return;
    }

    var id = matches[1];

    getIPPData(function(err, data){

        if(_.find(data, function(x){
                return x.id == id;
            })){
            res.render("results", { data: data, msg: "Player already exists"});
        }else{
            async.waterfall([
                function(cb){
                    downloadPlayerPage(id, cb);
                },
                function(contents, cb){
                    parsePlayerData(id, contents, cb);
                },
                function(player, cb){

                    data.push(player);

                    var contents = JSON.stringify(data);
                    var fileName = __dirname + "/.data/ipp.json";

                    fs.writeFile(fileName, contents, function(err) {
                        cb(err, data);
                    });
                }
            ], function(err, data){
                res.render("results", {msg : err, data:data});
            })
        }
    });
});

app.get('/delete/:playerId', function(req, res) {

    if (!req.params.playerId) {
        return res.render("delete", {msg: "missing player id"});
    }

    getIPPData(function (err, data) {

        var before = data.length;

        data = _.reject(data, function (x) {
            return x.id == req.params.playerId;
        });

        if (data.length == before) {
            return res.render("delete", {msg: "player " + req.params.playerId + " doesnt exist"});
        } else {
            var contents = JSON.stringify(data);
            var fileName = __dirname + "/.data/ipp.json";

            fs.writeFile(fileName, contents, function (err) {
                if (err) return res.render("delete", {msg: err});
                res.redirect("/");
            });
        }
    });
});


var server = app.listen(3000, function () {

    var host = server.address().address;
    var port = server.address().port;

    console.log('Example app listening at http://%s:%s', host, port);
});

function downloadPlayerPage(id, done){

    var fileName = __dirname + "/.data/players/" + id + ".html";

    downloadFile("/ihdb/stats/pdisplay.php?pid=" + id, fileName, done);
}

function parsePlayerData(id, content, done){

    async.waterfall(
        [
            function(cb){
                getVal({id:id}, 'name', /<h1 itemprop="name" class="title">([\w\s]+)<\/h1>/, content, cb);
            },
            function(data, cb){
                getVal(data, 'draft_year', /<a href="\/ihdb\/draft\/nhl([0-9]+)e.html"/, content, cb);
            },
            function(data, cb){

                data.stats = [];
                var statsPattern = /<td[^>]*>([0-9]{4}-[0-9]+)<\/td>\s.*<a href="([^"]*)">([\w\s\.]+)<\/a><\/td>\s<td[^>]*>(\w*)<\/td>\s<td>([0-9]*)<\/td>\s<td>([0-9]*)<\/td>\s<td>([0-9]*)<\/td>\s/g;

                var matches;
                while((matches = statsPattern.exec(content)) !== null){

                    if(!matches || matches.length < 8){
                        return cb("could not get player stats");
                    }

                    console.log(matches.index);

                    data.stats.push({
                        year: matches[1],
                        team_url: matches[2],
                        team_name: matches[3],
                        team_league: matches[4],
                        games_played: parseInt(matches[5]),
                        goals: parseInt(matches[6]),
                        assists: parseInt(matches[7]),
                        points: parseInt(matches[6]) + parseInt(matches[7])
                    });
                }

                cb(null, data);
            },
            function(data, cb){
                getTeamGGG(data, cb);
            },
            function(data, cb){
                calculateIPPInfo(data, cb);
            }
        ],
        function(err, data) {
            JSON.stringify(data);
            done(err, data);
        });
}

function getVal(data, key, pattern, text, done){

    var matches = pattern.exec(text);

    if(!matches || matches.length < 2) return done("could not determine " + key);

    console.log(key, matches[1]);
    data[key] = matches[1];

    done(null, data);
}

function getTeamGGG(data, done){

    async.each(data.stats, function(stat, cb){

        var match = /\/ihdb\/stats\/leagues\/seasons\/teams\/([0-9]+).html/.exec(stat.team_url);

        if(!match || match.length < 2){
            return done("could not get key for team season");
        }

        var key = match[1]; // get from url
        var fileName = __dirname + "/.data/teams/" + key + ".html";

        downloadFile(stat.team_url, fileName, function(err, content){

            var p = /<td[^>]*>Totals<\/td>\s<td><\/td>\s<td>([0-9]+)<\/td>\s<td>([0-9]+)<\/td>\s<td>([0-9]+)<\/td>\s<td>([0-9]+)<\/td>/;

            match = p.exec(content);

            if(!match || match.length < 5){
                return done("could not get team stats from " + stat.team_url);
            }

            var gp = {
                'OHL' : 68,
                'WHL' : 72,
                'QMJH' : 68,
                'NHL' : 82,
                'AHL' : 73.5 // sometimes 73, some 74
            };

            if(gp[stat.team_league.toUpperCase()]){
                stat.team_goals = parseInt(match[1]);
                stat.team_assists = parseInt(match[2]);
                stat.team_points = parseInt(match[3]);
                stat.team_pims = parseInt(match[4]);
                stat.team_ggg = stat.team_goals/gp[stat.team_league.toUpperCase()];
                stat.ipp = stat.points / (stat.team_ggg * stat.games_played);
            }else {
                console.log("could not find stats for league", stat.team_leage);
            }

            cb(null);
        });

    }, function(err){
        done(err, data);
    });
}

function downloadFile(urlPath, fileName, done){

    if(fs.existsSync(fileName)) {
        fs.readFile(fileName, "utf-8", function(err, contents){
            done(err, contents);
        });
    }else{

        var util = require("util"),
            http = require("http");

        var options = {
            host: "www.hockeydb.com",
            port: 80,
            path: urlPath
        };

        var content = "";

        var req = http.request(options, function(res) {
            res.setEncoding("utf8");
            res.on("data", function (chunk) {
                content += chunk;
            });

            res.on("end", function () {
                fs.writeFile(fileName, content, function(err) {
                    if(err) console.log(err);
                    done(err, content);
                });
            });
        });

        req.end();
    }

}

function calculateIPPInfo(data, done){

    var draftYear = parseInt(data.draft_year.substring(0, 4));

    var currentYear = draftYear -1;

    var keys = ["draft-1","draft","draft1","draft2","draft3","draft4"];

    for(var i=0; i < keys.length; i++){

        var key = keys[i];
        var year = currentYear + "-" + (currentYear+1).toString().substring(2);

        var stats = _.filter(data.stats, function(x){
            return x.year == year;
        });

        if(stats && stats.length){
            data[key] = stats
        } else {
            data[key] = []
        }

        currentYear++;
    }

    done(null, data);
}

function getIPPData(done){

    var fileName = __dirname + "/.data/ipp.json";

    fs.readFile(fileName, "utf-8", function(err, contents){
        if(err) return done(err);

        var data = [];
        if(contents) {
            data = JSON.parse(contents);
        }
        done(null, data);
    });

}

