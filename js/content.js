const prefix = "frienddl.io | ";
console.log(prefix + "Content script loaded");

let BACKGROUND_PORT = chrome.runtime.connect(
  {
    name: "c2b"
  }
);
console.log(prefix + "c2b port set up");

let GAME_POINTS = [];
let IN_GAME = false;

function getTotalGamePoints() {
  let totalGamePoints = 0;
  function countPoints(i) {
    totalGamePoints += i.points;
  }

  GAME_POINTS.forEach(countPoints);
  console.debug(prefix + `totalGamePoints: ${totalGamePoints}`);

  return totalGamePoints;
}

function calculateNewPoints(currentPoints, currentRound) {
  console.debug(prefix + `currentPoints: ${currentPoints}`);

  if (currentPoints === null || currentPoints === undefined) {
    console.debug(prefix + "currentPoints is null or undefined");
    return null;
  } else if (currentPoints === 0) {
    console.debug(prefix + "currentPoints is 0; skipping")
    return 0;
  } else if (GAME_POINTS.length === 0) {
    return currentPoints;
  }

  let lastPointObject = GAME_POINTS[GAME_POINTS.length - 1];

  let totalGamePoints = getTotalGamePoints();

  let latestRound = lastPointObject.round;
  console.debug(prefix + `latestRound: ${latestRound}`);

  if (currentPoints === totalGamePoints) {
    let now = new Date().getTime();
    GAME_POINTS[GAME_POINTS.length - 1].time = now;
    return 0;
  } else if (currentRound < latestRound || currentPoints < totalGamePoints) {
    GAME_POINTS = [];
    return currentPoints;
  }

  return currentPoints - totalGamePoints;
}

function logPointsAsync(currentPoints, currentRound, forceUpdate) {
  return new Promise(
    resolve => {
      let newPoints = calculateNewPoints(currentPoints, currentRound);

      chrome.storage.sync.get(
        [
          "scoreKeeperAutomatic",
          "pointsArray"
        ],
        function(response) {
          let scoreKeeperAutomatic = response.scoreKeeperAutomatic;

          console.debug(prefix + `scoreKeeperAutomatic: ${scoreKeeperAutomatic}`);

          if (scoreKeeperAutomatic !== false) {
            scoreKeeperAutomatic = true;
          }

          let now = new Date().getTime();

          if (newPoints === undefined || newPoints === null || newPoints <= 0) {
            console.debug(prefix + "newPoints is undefined, null, 0, or negative; skipping");
          } else {
            console.debug(prefix + `Score keeper set to manual; won't send new points: ${newPoints}`);
            GAME_POINTS.push(
              {
                time: now,
                round: currentRound,
                points: newPoints,
                sentToScoreKeeper: false
              }
            );
          }

          if (scoreKeeperAutomatic || forceUpdate) {
            let sentToScoreKeeper = true;
            let totalUnsentPoints = 0

            if (forceUpdate && response.pointsArray.length === 0) {
              function countPointsAndMarkSent(i) {
                totalUnsentPoints += i.points;
                i.sentToScoreKeeper = true;
              }

              GAME_POINTS.forEach(countPointsAndMarkSent);
            } else {
              function countPointsAndMarkSent(i) {
                if (i.sentToScoreKeeper === false) {
                  totalUnsentPoints += i.points;
                  i.sentToScoreKeeper = true;
                }
              }

              GAME_POINTS.forEach(countPointsAndMarkSent);
            }

            console.debug(prefix + `totalUnsentPoints: ${totalUnsentPoints}`);

            if (totalUnsentPoints.length === 0 || totalUnsentPoints === 0) {
              console.debug(prefix + "No unsent points found");
            } else {
              console.debug(prefix + `Sending unsent points: ${totalUnsentPoints}`);
              BACKGROUND_PORT.postMessage(
                {
                  points: totalUnsentPoints,
                  totalGamePoints: getTotalGamePoints(),
                  task: "logPoints"
                }
              );
            }
          } else {
            console.debug(prefix + `Score keeper set to manual; won't send new points: ${newPoints}`);
          }

          resolve(true);
        }
      );
    }
  );
}

function bypassModals() {
  let modalButton = $("#modalDisconnect button:contains('Ok')");
  let modalVisible = modalButton.is(":visible");
  if (modalVisible) {
    console.debug(prefix + "Disconnected");
    modalButton.click();
    return true;
  }

  modalButton = $("#modalKicked button:contains('Ok')");
  modalVisible = modalButton.is(":visible");
  if (modalVisible) {
    console.debug(prefix + "Kicked");
    modalButton.click();
    return true;
  }

  return false;
}

function receiveRequest(request, sender, sendResponse) {
  let task = request.task;

  console.debug(prefix + `Received request: ${task}`);

  if (task === "getScore") {
    if ($(".player").length < 2) {
      console.debug(prefix + "Players don't exist");
      sendResponse(
        {
          points: null
        }
      );
    } else {
      $(".player").each(
        function() {
          let playerName = $(this).find(".name").html();

          if (playerName.includes("(You)")) {
            let currentPoints = parseInt($(this).find(".score").html().replace("Points: ", ""));
            let currentRound = parseInt($("#round")[0].innerText.split(" ")[1]);
            let forceUpdate = true;
            logPointsAsync(currentPoints, currentRound, forceUpdate);
          }
        }
      );
    }
  } else if (task === "friendSearch") {
    chrome.storage.local.get(
      [
        "state"
      ],
      function(response) {
        if (response.state === "search") {
          console.debug(prefix + "Waiting for play button");
          var checkIfPlayButtonExists = setInterval(
            function() {
              if ($("button[type='submit']").length >= 2) {
                console.debug(prefix + "Play button exists, clicking now");

                let playButton = $("button[type='submit']")[0];
                console.debug(prefix + "Clicking play button");
                playButton.click();
                clearInterval(checkIfPlayButtonExists);
              } else {
                console.debug(prefix + "Play button doesn't exist");
              }
            },
            100
          );

          console.debug(prefix + "Waiting for players");
          var checkIfPlayersExist = setInterval(
            function() {
              let disconnectedOrKicked = bypassModals();
              if (disconnectedOrKicked) {
                sendResponse(
                  {
                    players: [],
                    tabId: request.tabId
                  }
                );
              }

              if ($(".player").length >= 1 && $(".player").is(":visible")) {
                console.debug(prefix + "Players exist");

                let playersArray = [];
                $(".player").each(
                  function() {
                    let playerName = $(this).find(".name").html();
                    if (playerName !== null && playerName !== "" && !(playersArray.includes(playerName))) {
                      playersArray.push(playerName);
                    }
                  }
                );

                clearInterval(checkIfPlayersExist);
                console.debug(prefix + `Sending playersArray: ${playersArray.toString()}`);
                sendResponse(
                  {
                    players: playersArray,
                    tabId: request.tabId
                  }
                );
              }
            },
            100
          );
        }
      }
    );
  }

  return true;
}

// Listen for messages from background
chrome.runtime.onMessage.addListener(receiveRequest);

function updatePlayerData() {
  if (chrome.app !== undefined || typeof chrome.app.isInstalled !== "undefined") {
    chrome.storage.local.get(
      [
        "playerName",
        "playerAvatar"
      ],
      function(response) {
        let currentPlayerName = $("#inputName")[0].value;
        let currentPlayerAvatar = $("#loginAvatarCustomizeContainer").prop('outerHTML');
        let playerDataUpdates = {};

        if (response.playerName !== currentPlayerName) {
          console.debug(prefix + "Updating player name");
          playerDataUpdates.playerName = currentPlayerName;
        }

        if (response.playerAvatar !== currentPlayerAvatar) {
          console.debug(prefix + "Updating player avatar");
          playerDataUpdates.playerAvatar = currentPlayerAvatar;
        }

        if (Object.entries(playerDataUpdates).length > 0) {
          chrome.storage.local.set(
            playerDataUpdates,
            function() {}
          );
        }
      }
    );
  }
}

// Check for player name input change
$("#inputName").on("propertychange input", updatePlayerData);

// Check for avatar arrows clicked
$(".avatarArrows").click(updatePlayerData);

// Check for randomize button clicked
$("#buttonAvatarCustomizerRandomize").click(updatePlayerData);

updatePlayerData();

function setPlayerObserver() {
  $(".player").each(
    function() {
      let playerName = $(this).find(".name").html();
      if (playerName.includes("(You)")) {
        // Credit: https://forum.freecodecamp.org/t/how-can-i-detect-or-trigger-an-event-when-text-in-p-tag-is-changed/270692/4
        // Select the node that will be observed for mutations
        var targetNode = $(this).find('.score')[0];

        // Options for the observer (which mutations to observe)
        var config = { childList: true };

        // Callback function to execute when mutations are observed
        var callback = async function(mutationsList, observer) {
          for (var mutation of mutationsList) {
            let currentPoints = parseInt(mutation.target.innerText.replace("Points: ", ""));
            let currentRound = parseInt($("#round")[0].innerText.split(" ")[1]);
            let forceUpdate = false;

            await logPointsAsync(currentPoints, currentRound, forceUpdate);
          }
        };
        console.debug(prefix + "Score observer set");

        // Create an observer instance linked to the callback function
        var observer = new MutationObserver(callback);

        // Start observing the target node for configured mutations
        observer.observe(targetNode, config);

        IN_GAME = true;
      }
    }
  );
}

console.debug(prefix + "Waiting for players");
var checkIfPlayersExist = setInterval(
  function() {
    if ($(".player").length >= 2 && $(".player").is(":visible")) {
      if (!IN_GAME) {
        setPlayerObserver();
      }
    } else {
      IN_GAME = false;
    }
  },
  100
);
