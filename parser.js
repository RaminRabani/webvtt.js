// Not intended to be fast.

var NEWLINE = /\r\n|\r|\n/,
    SPACE = /[\u0020\t\f]/,
    NOSPACE = /[^\u0020\t\f]/

var WebVTTParser = function() {
  var linePos = 0,
      errors = []
  function err(message, col) {
    errors.push({message:message, line:linePos+1, col:col})
  }
  this.parse = function(input) {
    //XXX need global search and replace for \0
    var startTime = (new Date).getTime(),
        lines = input.split(NEWLINE),
        cues = []

    /* SIGNATURE */
    if(
      lines[linePos].length < 6 ||
      lines[linePos].indexOf("WEBVTT") != 0 ||
      lines[linePos].length > 6 &&
        lines[linePos][6] != " " &&
        lines[linePos][6] != "\t"
    ) {
      err("No valid signature.")
    }

    linePos++

    /* HEADER */
    while(lines[linePos] != "" && lines[linePos] != undefined) {
      // XXX not called out in the specification
      err("No blank line after the signature. Line ignored.")
      linePos++
    }

    /* CUE LOOP */
    while(lines[linePos] != undefined) {
      var cue
      while(lines[linePos] == "") {
        linePos++
      }
      if(lines[linePos] == undefined)
        continue

      cue = {
        start:0,
        end:0,
        identifier:"",
        pauseOnExit:false,
        direction:"horizontal",
        snapToLines:true,
        linePosition:"auto",
        textPosition:50,
        size:100,
        alignment:"middle",
        text:"",
        tree:null
      }

      if(lines[linePos].indexOf("-->") == -1) {
        cue.identifier = lines[linePos]

        linePos++

        if(lines[linePos] == "" || lines[linePos] == undefined) {
          err("Cue identifier cannot be standalone.")
          continue
        }

      }
      var timings = new WebVTTCueTimingsAndSettingsParser(lines[linePos], err)
      if(!timings.parse(cue)) {
        /* BAD CUE */

        cue = null

        /* BAD CUE LOOP */
        while(lines[linePos] != "" && lines[linePos] != undefined) {
          linePos++
        }
        continue
      }

      /* CUE TEXT LOOP */
      while(lines[linePos] != "" && lines[linePos] != undefined) {
        if(cue.text != "")
          cue.text += "\n"
        cue.text += lines[linePos]
        linePos++
      }
      var cuetextparser = new WebVTTCueTextParser(cue.text, err)
      cue.tree = cuetextparser.parse()
      cues.push(cue)

      linePos++
    }
    /* END */
    return {cues:cues, errors:errors, time:(new Date).getTime()-startTime}
  }
}

var WebVTTCueTimingsAndSettingsParser = function(line, errorHandler) {
  var line = line,
      pos = 0,
      parseError = false,
      err = function(message) {
        parseError = true
        errorHandler(message, pos+1)
      }
  function skip(pattern) {
    while(
      line[pos] != undefined &&
      pattern.test(line[pos])
    ) {
      pos++
    }
  }
  function collect(pattern) {
    var str = ""
    while(
      line[pos] != undefined &&
      pattern.test(line[pos])
    ) {
      str += line[pos]
      pos++
    }
    return str
  }
  /*
  http://www.whatwg.org/specs/web-apps/current-work/multipage/the-video-element.html#collect-a-webvtt-timestamp
  */
  function timestamp() {
    var units = "minutes",
        val1,
        val2,
        val3,
        val4
    // 3
    if(line[pos] == undefined) {
      err("No timestamp found.")
      return
    }
    // 4
    if(!/\d/.test(line[pos])) {
      err("Timestamp must start with a character in the range 0-9.")
      return
    }
    // 5-7
    val1 = collect(/\d/)
    if(val1.length > 2 || parseInt(val1) > 59) {
      units = "hours"
    }
    // 8
    if(line[pos] != ":") {
      err("No time unit separator found.")
      return
    }
    pos++
    // 9-11
    val2 = collect(/\d/)
    if(val2.length != 2) {
      err("Must be exactly two digits.")
      return
    }
    // 12
    if(units == "hours" || line[pos] == ":") {
      if(line[pos] != ":") {
        err("No seconds found or minutes is greater than 59.")
        return
      }
      pos++
      val3 = collect(/\d/)
      if(val3.length != 2) {
        err("Must be exactly two digits.")
        return
      }
    } else {
      val3 = val2
      val2 = val1
      val1 = ""
    }
    // 13
    if(line[pos] != ".") {
      err("No decimal separator found.")
      return
    }
    pos++
    // 14-16
    val4 = collect(/\d/)
    if(val4.length != 3) {
      err("Milliseconds must be given in three digits.")
      return
    }
    // 17
    if(parseInt(val2) > 59) {
      err("You cannot have more than 59 minutes.")
      return
    }
    if(parseInt(val3) > 59) {
      err("You cannot have more than 59 seconds.")
      return
    }
    return parseInt(val1) * 60 * 60 + parseInt(val2) * 60 + parseInt(val3) + parseInt(val4) / 1000
  }

  /*
  http://www.whatwg.org/specs/web-apps/current-work/multipage/the-video-element.html#parse-the-webvtt-settings
  */
  function settings(cue) {
    var seen = [],
        setting = "",
        value = ""
    function otherwise() {
      if(line[pos] != undefined && NOSPACE.test(line[pos])) {
        err("Invalid setting.")
        skip(NOSPACE)
        return true
      }
      return
    }
    while(line[pos] != undefined) {
      // XXX specification needs update for this
      skip(SPACE)
      if(line[pos] == undefined) {
        return
      }

      setting = line[pos]
      pos++
      if(seen.indexOf(setting) != -1) {
        err("Duplicate setting.")
      }
      seen.push(setting)

      // 5
      if(line[pos] != ":") {
        setting = ""
      }
      // 6 XXX this also skips spaces is that really intentional?
      pos++
      // 7
      if(line[pos] == undefined) {
        // XXX specification needs update for this
        err("No value for setting defined.")
        return
      }
      // 8
      if(setting == "D") { // writing direction
        value = collect(NOSPACE)
        if(value != "vertical" && value != "vertical-lr") {
          err("Writing direction can only be set to 'vertical' or 'vertical-lr'.")
          continue
        }
        cue.direction = value
      } else if(setting == "L") { // line position
        value = collect(/[-%0-9]/)
        // 2
        if(otherwise()) {
          continue
        }
        if(!/\d/.test(value)) {
          err("Line position takes a number or percentage.")
          continue
        }
        // 4
        if(value.indexOf("-", 1) != -1) {
          err("Line position can only have '-' at the start.")
          continue
        }
        //5
        if(value.indexOf("%") != -1 && value.indexOf("%") != value.length-1) {
          err("Line position can only have '%' at the end.")
          continue
        }
        // 6
        if(value[0] == "-" && value[value.length-1] == "%") {
          err("Line position cannot be a negative percentage.")
          continue
        }
        // 8
        if(value[value.length-1] == "%") {
          if(parseInt(value) > 100) {
            err("Line position cannot be >100%.")
            continue
          }
          cue.snapToLines = false
        }
        cue.linePosition = parseInt(value)
      } else if(setting == "T") { // text position
        value = collect(/\d/)
        // 3
        if(line[pos] != "%") {
          err("Text position must be a percentage.")
          skip(NOSPACE)
          continue
        }
        // 4-6
        pos++
        if(otherwise() || value == "") {
          continue
        }
        // 7-8
        if(parseInt(value) > 100) {
          err("Size cannot be >100%.")
          continue
        }
        cue.textPosition = parseInt(value)
      } else if(setting == "S") { // size
        value = collect(/\d/)
        // 3
        if(line[pos] != "%") {
          err("Size must be a percentage.")
          skip(NOSPACE)
          continue
        }
        // 4-6
        pos++
        if(otherwise() || value == "") {
          continue
        }
        // 7-8
        if(parseInt(value) > 100) {
          err("Size cannot be >100%.")
          continue
        }
        cue.size = parseInt(value)
      } else if(setting == "A") { // alignment
        value = collect(NOSPACE)
        if(value != "start" && value != "middle" && value != "end") {
          err("Alignment can only be set to 'start', 'middle', or 'end'.")
          continue
        }
        cue.alignment = value
      } else {
        err("Invalid setting.")
        skip(NOSPACE)
      }
    }
  }

  this.parse = function(cue) {
    skip(SPACE)
    cue.start = timestamp()
    if(cue.start == undefined) {
      return
    }
    skip(SPACE)
    // 6-8
    if(line[pos] != "-") {
      err("No valid timestamp separator found.")
      return
    }
    pos++
    if(line[pos] != "-") {
      err("No valid timestamp separator found.")
      return
    }
    pos++
    if(line[pos] != ">") {
      err("No valid timestamp separator found.")
      return
    }
    pos++
    skip(SPACE)
    cue.end = timestamp()
    if(cue.end == undefined) {
      return
    }
    skip(SPACE)
    settings(cue)
    if(parseError)
      return
    return true
  }
  this.parseTimestamp = function() {
    var timestamp = timestamp()
    if(line[pos] != undefined) {
      err("Timestamp must not have trailing characters.")
      return
    }
    return timestamp
  }
}

var WebVTTCueTextParser = function(line, errorHandler) {
  var line = line,
      pos = 0,
      err = function(message) {
        errorHandler(message, pos+1)
      }

  this.parse = function() {
    var result = {children:[]},
        current = result

    function attach(token) {
      current.children.push({type:"object", name:token[1], children:[], parent:current})
      current = current.children[current.children.length-1]
    }

    while(line[pos] != undefined) {
      var token = nextToken()
      if(token[0] == "text") {
        current.children.push({type:"text", value:token[1], parent:current})
      } else if(token[0] == "start tag") {
        var name = token[1]
        if(
          name == "c" ||
          name == "i" ||
          name == "b" ||
          name == "u" ||
          name == "ruby"
        ) {
          attach(token)
        } else if(name == "rt" && current.name == "ruby") {
          attach(token)
        } else if(name == "v") {
          attach(token)
          token.value = token[3] // annotation
        } else {
          err("Incorrect start tag.")
        }
      } else if(token[0] == "end tag") {
        if(token[1] == current.name) {
          current = current.parent
        } else if(token[1] == "ruby" && current.name == "rt") {
          current = current.parent.parent
        } else {
          err("Incorrect end tag.")
        }
      } else if(token[0] == "timestamp") {
        var timings = new WebVTTCueTimingsAndSettingsParser(token[1], err),
            timestamp = timings.parseTimestamp()
        if(timestamp != undefined) {
          current.children.push({type:"timestamp", value:token[1], parent:current})
        }
      }
    }
    return result
  }

  function nextToken() {
    var state = "data",
        result = "",
        buffer = "",
        classes = []
    while(line[pos-1] != undefined || pos == 0) {
      var c = line[pos]
      if(state == "data") {
        if(c == "&") {
          buffer = c
          state = "escape"
        } else if(c == "<" && result == "") {
          state = "tag"
        } else if(c == "<" || c == undefined) {
          return ["text", result]
        } else {
          result += c
        }
      } else if(state == "escape") {
        if(c == ";") {
          if(buffer == "&amp") {
            result += "&"
          } else if(buffer == "&lt") {
            result += "<"
          } else if(buffer == "&gt") {
            result += ">"
          } else {
            err("Incorrect escape.")
            result += buffer + ";"
          }
          state = "data"
        } else if(/[ampltg]/.test(c)) {
          buffer += c
        } else if(c == undefined) {
          err("Incorrect escape.")
          result += buffer
          return ["text", result]
        } else {
          // XXX spec does not append c
          err("Incorrect escape.")
          result += buffer + c
          state = "data"
        }
      } else if(state == "tag") {
        if(c == " " || c == "\t") {
          state = "start tag annotation"
        } else if(c == ".") {
          state = "start tag class"
        } else if(c == "/") {
          state = "end tag"
        } else if(/\d/.test(c)) {
          result = c
          state = "timestamp tag"
        } else if(c == ">" || c == undefined) {
          if(c == ">")
            pos++
          return ["start tag", "", [], ""]
        } else {
          result = c
          state = "start tag"
        }
      } else if(state == "start tag") {
        if(c == " " || c == "\t") {
          state = "start tag annotation"
        } else if(c == ".") {
          state = "start tag class"
        } else if(c == ">" || c == undefined) {
          if(c == ">")
            pos++
          return ["start tag", result, [], ""]
        } else {
          result += c
        }
      } else if(state == "start tag class") {
        if(c == " " || c == "\t") {
          classes.push(buffer)
          buffer = ""
          state = "start tag annotation"
        } else if(c == ".") {
          classes.push(buffer)
          buffer = ""
        } else if(c == ">" || c == undefined) {
          if(c == ">")
            pos++
          classes.push(buffer)
          return ["start tag", result, classes, ""]
        } else {
          buffer += c
        }
      } else if(state == "start tag annotation") {
        if(c == ">" || c == undefined) {
          if(c == ">")
            pos++
          // XXX normalize buffer
          return ["start tag", result, classes, buffer]
        } else {
          buffer +=c
        }
      } else if(state == "end tag") {
        if(c == ">" || c == undefined) {
          if(c == ">")
            pos++
          return ["end tag", result]
        } else {
          result += c
        }
      } else if(state == "timestamp tag") {
        if(c == ">" || c == undefined) {
          if(c == ">")
            pos++
          return ["timestamp", result]
        } else {
          result += c
        }
      } else {
        err("Never happens.") // The joke is it might.
      }
      // 8
      pos++
    }
  }
}

/*
function serializeChildren(children) {
  // lousy serialize function
  var result = ""
  for (var i = 0; i < children.length; i++) {
    var child = children[i]
    if(child.type == "text") {
      result += child.value
    } else if(child.type == "object") {
      result += "<" + child.name + ">"
      if(child.children)
        result += serializeChildren(child.children)
      result += "</" + child.name + ">"
    } else {
      result += "XXX"
    }
  }
  return result
}

var tralla = new WebVTTCueTextParser("&amp;<i>c")
    trollo = tralla.parse().children
alert(serializeChildren(trollo))
*/