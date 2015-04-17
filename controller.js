var _ = require('lodash');
var async = require("async");
var fs = require("fs");

exports.show = function (req, res) {
    getIPPData(function (err, data) {
        res.render("results", {msg: err, data: data});
    });
};

exports.addPlayer = function(req, res) {

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
            processPlayer(id, function(err, player){
                if(err) return res.render("results", {msg : err, data:data});

                data.push(player);

                var contents = JSON.stringify(data);
                var fileName = __dirname + "/.data/ipp.json";

                fs.writeFile(fileName, contents, function(err) {
                    res.render("results", {msg : err, data:data});
                });
            });
        }
    });
};

exports.removePlayer = function(req, res) {

    if (!req.params.playerId) {
        return res.render("error", {msg: "missing player id"});
    }

    getIPPData(function (err, data) {

        var before = data.length;

        data = _.reject(data, function (x) {
            return x.id == req.params.playerId;
        });

        if (data.length == before) {
            return res.render("error", {msg: "player " + req.params.playerId + " doesnt exist"});
        } else {
            var contents = JSON.stringify(data);
            var fileName = __dirname + "/.data/ipp.json";

            fs.writeFile(fileName, contents, function (err) {
                if (err) return res.render("error", {msg: err});
                res.redirect("/");
            });
        }
    });
};

exports.regenerateData = function(req, res){

    getIPPData(function(err, data){

        if(err) return res.render("error", {msg : err});

        data = _.compact(data);

        async.map(data, function(record, cb){

            console.log("regen", record.name);
            processPlayer(record.id, function(err, player){
                cb(err, player);
            });

        },function(err, data){
            if(err) return res.render("error", {msg : err});

            var contents = JSON.stringify(data);
            var fileName = __dirname + "/.data/ipp.json";

            fs.writeFile(fileName, contents, function(err) {
                if(err) return res.render("error", {msg : err});
                res.redirect("/");
            });
        })
    });
};

function processPlayer(id, done){
    async.waterfall([
        function(cb){
            downloadPlayerPage(id, cb);
        },
        function(contents, cb){
            parsePlayerData(id, contents, cb);
        }
    ], function(err, player){
        done(err, player)
    });
}

function downloadPlayerPage(id, done){

    var fileName = __dirname + "/.data/players/" + id + ".html";

    downloadFile("/ihdb/stats/pdisplay.php?pid=" + id, fileName, done);
}

function parsePlayerData(id, content, done){

    async.waterfall(
        [
            function(cb){
                getVal({id:id}, 'name', /<h1 itemprop="name" class="title">([^<]+)<\/h1>/, content, cb);
            },
            function(data, cb){
                getVal(data, 'draft_year', /<a href="\/ihdb\/draft\/nhl([0-9]+)e.html"/, content, cb);
            },
            function(data, cb){

                data.stats = [];
                var statsPattern = /<td[^>]*>([0-9]{4}-[0-9]+)<\/td>\s.*<a href="([^"]*)">([^<]+)<\/a><\/td>\s<td[^>]*>([^<]*)<\/td>\s<td>([0-9]*)<\/td>\s<td>([0-9]*)<\/td>\s<td>([0-9]*)<\/td>\s/g;

                var matches;
                while((matches = statsPattern.exec(content)) !== null){

                    if(!matches || matches.length < 8){
                        return cb("could not get player stats");
                    }

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

            stat.team_goals = parseInt(match[1]);
            stat.team_assists = parseInt(match[2]);
            stat.team_points = parseInt(match[3]);
            stat.team_pims = parseInt(match[4]);

            if(gp[stat.team_league.toUpperCase()]){
                stat.team_ggg = stat.team_goals/gp[stat.team_league.toUpperCase()];
                stat.ipp = stat.points / (stat.team_ggg * stat.games_played);
            } else {

                var playerTeam = /<td>([0-9]+)<\/td>\s?<td>([0-9]+)<\/td>\s?<td>([0-9]+)<\/td>\s?<td>([0-9]+)<\/td>\s?<td>([0-9]+)<\/td>\s?/g;

                var maxGP = 0;
                var matches;
                while ((matches = playerTeam.exec(content)) !== null) {
                    if (matches && matches.length > 1) {
                        maxGP = Math.max(maxGP, parseInt(matches[1]));
                    }
                }

                if (maxGP > 0) {
                    stat.team_ggg = stat.team_goals/maxGP;
                    stat.ipp = stat.points / (stat.team_ggg * stat.games_played);
                } else {
                    console.log("could not find stats for league", stat.team_league);
                }
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

    var currentYear = draftYear -2;

    var keys = ["draft-1","draft","draft1","draft2","draft3","draft4","draft5"];

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

