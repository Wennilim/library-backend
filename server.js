const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 读取书籍数据
const books = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/data/books.json"), "utf-8")
);

// 读取用户借阅记录数据
const records = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/data/record.json"), "utf-8")
);

const announcement = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/data/announcement.json"), "utf-8")
);

const userPreferences = {};

// 推荐书籍类型算法
function getRecommendations(genres, userId) {
  const userHistory = userPreferences[userId] || [];
  const recommendedBooks = books.filter((book) => {
    const genreMatches =
      Array.isArray(book.genre) &&
      book.genre.some((g) =>
        g.split(/，|,/).some((genre) => genres.includes(genre.trim()))
      );
    const userPreferred = userHistory.some(
      (clickedBook) => clickedBook.id === book.id
    );
    return genreMatches || userPreferred;
  });
  return recommendedBooks;
}

// 获取前三最受欢迎的 genre
app.get("/top-three-genres", (req, res) => {
  const genreCounts = {};
  records.forEach((record) => {
    if (Array.isArray(record.genre)) {
      record.genre.forEach((g) => {
        g.split(/，|,/).forEach((genre) => {
          genre = genre.trim();
          if (genre) {
            genreCounts[genre] = (genreCounts[genre] || 0) + 1;
          }
        });
      });
    }
  });

  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((entry) => ({ genre: entry[0], count: entry[1] }));
  res.json(topGenres);
});

// 获取最多人借的前五本书籍
app.get("/top-books", (req, res) => {
  const bookCounts = {};

  records.forEach((record) => {
    if (record.borrower) {
      bookCounts[record.title] = (bookCounts[record.title] || 0) + 1;
    }
  });

  const topBooks = Object.entries(bookCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((entry) => ({ title: entry[0], count: entry[1] }));

  res.json(topBooks);
});

// 获取全部书籍类型
app.get("/genres", (req, res) => {
  const genres = new Set();
  books.forEach((book) => {
    if (Array.isArray(book.genre)) {
      book.genre.forEach((g) => {
        g.split(/，|,/).forEach((genre) => {
          genres.add(genre.trim());
        });
      });
    } else {
      console.error(
        `Book with id ${book.id} has an invalid genre: ${book.genre}`
      );
    }
  });

  res.json(Array.from(genres));
});

// 获取书籍详情
app.get("/getBookDetails/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const book = books.find((book) => book.id === id);
  if (!book) {
    return res.status(404).send({ error: "Book not found" });
  }

  // const token = req.header.authorization;

  // if(token) {
  //   const userId = getUserIdByToken(token)
  //   incrementUserFavouriteGenre(userId, book.genre)
  // }

  res.send(book);
});

// 推荐书籍类型接口
app.post("/recommend", (req, res) => {
  const { genres } = req.body;
  if (!genres || genres.length === 0) {
    return res.status(400).send({ error: "Genres are required" });
  }
  const recommendations = getRecommendations(genres);
  res.send(recommendations);
});

// const authMiddleware = (req, res, next)=>{
//   req.header
//   // check if token exist
//   res.status(401)
//   // check if token valid
//   res.status(401)
//   /// all ok
//   // token get user detail (id)
//   req.userId = 1
//   next()
// }

const getRecommendationsByGenre = (genre) => {
  return books.filter((book) => book.genre.includes(genre));
};

const getRecommendationsBySeries = (series) => {
  return books.filter((book) => book.series === series);
};

const getRecommendationsByAuthor = (author) => {
  return books.filter((book) => book.author === author);
};

app.post("/maybeUlike", (req, res) => {
  const { series, author, genre, title } = req.body;

  const genreBooks = genre.reduce((acc, g) => {
    return acc.concat(getRecommendationsByGenre(g));
  }, []);

  const seriesBooks = series ? getRecommendationsBySeries(series) : [];
  const authorBooks = getRecommendationsByAuthor(author);

  const recommendations = [
    ...seriesBooks,
    ...authorBooks,
    ...genreBooks,
  ].filter((book) => book.title !== title);

  const uniqueRecommendations = Array.from(
    new Set(recommendations.map((book) => book.title))
  ).map((title) => recommendations.find((book) => book.title === title));

  res.send(uniqueRecommendations.slice(0, 10));
});

app.post("/scrape", async (req, res) => {
  const { isbn } = req.body;

  const url = `https://search.books.com.tw/search/query/key/${isbn}/cat/all`;

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });

    await page.waitForSelector('h4 a');
    await page.waitForSelector('div p.author a');
    await page.waitForSelector('img.b-lazy');

    const result = await page.evaluate(() => {
      const bookTitle = document
        .querySelector("h4 a")
        .getAttribute("title")
        .trim();
      const bookAuthor = document
        .querySelector("div p.author a")
        .getAttribute("title")
        .trim();
      const bookCover = document
        .querySelector("img.b-lazy")
        .getAttribute("src");

      return {
        title: bookTitle,
        author: bookAuthor,
        img: bookCover,
      };
    });

    await browser.close();

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error occurred while scraping the data.");
  }
});

app.get("/announcement", (_, res) => {
  return res.json(announcement);
});

const PORT = process.env.PORT || 8888;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
