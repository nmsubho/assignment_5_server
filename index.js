require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

const cors = require("cors");

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@ums.8wgaax7.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const run = async () => {
  try {
    const db = client.db("tech-net");
    const bookCollection = db.collection("book");
    const myListCollection = db.collection("mylist");

    app.get("/books", async (req, res) => {
      const { searchTerm, ...filterData } = req.query;

      const searchFields = ["title", "author", "genre", "publicationDate"];

      const andConditions = [];

      if (searchTerm) {
        andConditions.push({
          $or: searchFields.map((field) => ({
            [field]: {
              $regex: searchTerm,
              $options: "i",
            },
          })),
        });
      }

      if (Object.keys(filterData).length) {
        andConditions.push({
          $and: Object.entries(filterData).map(([field, value]) =>
            field === "publicationYear"
              ? {
                  publicationDate: { $regex: `^${value}`, $options: "i" },
                }
              : {
                  [field]: {
                    $regex: "^" + value + "$",
                    $options: "i",
                  },
                }
          ),
        });
      }

      const whereConditions =
        andConditions.length > 0 ? { $and: andConditions } : {};

      const cursor = bookCollection.find(whereConditions).sort({ _id: -1 });
      const book = await cursor.toArray();

      res.send({ status: true, data: book });
    });

    app.post("/book", async (req, res) => {
      const book = req.body;
      try {
        const result = await bookCollection.insertOne(book);
        res.send(result);
      } catch (error) {
        console.log(error);
      }
    });

    app.get("/book/:id", async (req, res) => {
      const id = req.params.id;

      const result = await bookCollection.findOne({ _id: ObjectId(id) });
      console.log(result);
      res.send(result);
    });

    app.put("/book/:id", async (req, res) => {
      const id = req.params.id;
      const book = req.body;

      try {
        const result = await bookCollection.findOneAndUpdate(
          { _id: ObjectId(id) },
          { $set: book }
        );
        console.log(result);
        res.send(result);
      } catch (error) {
        res.status(500).send(error.message);
      }
    });

    app.delete("/book/:id", async (req, res) => {
      const id = req.params.id;

      const result = await bookCollection.deleteOne({ _id: ObjectId(id) });
      console.log(result);
      res.send(result);
    });

    app.get("/genres", (req, res) => {
      bookCollection.distinct("genre", (err, genres) => {
        if (err) {
          console.error(err);
          res.status(500).send("Internal Server Error");
        } else {
          res.json(genres);
        }
      });
    });

    // app.get("/publication-years", (req, res) => {
    //   bookCollection.distinct("publicationDate", (err, publicationYears) => {
    //     if (err) {
    //       console.error(err);
    //       res.status(500).send("Internal Server Error");
    //     } else {
    //       publicationYears = publicationYears?.map(
    //         (publicationYear) => publicationYear?.split("-")[0]
    //       );

    //       res.json(publicationYears);
    //     }
    //   });
    // });

    app.get("/publication-years", async (req, res) => {
      try {
        const uniqueYears = await bookCollection
          .aggregate([
            {
              $group: {
                _id: { $substr: ["$publicationDate", 0, 4] },
              },
            },
            {
              $sort: { _id: 1 },
            },
          ])
          .toArray();

        const yearList = uniqueYears.map((year) => year._id);
        res.json(yearList);
      } catch (error) {
        console.error("Failed to retrieve unique years:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/review/:id", async (req, res) => {
      const bookId = req.params.id;
      const review = req.body.review;
      let result = null;

      try {
        result = await bookCollection.updateOne(
          { _id: ObjectId(bookId) },
          { $push: { reviews: review } }
        );

        console.log(result);
      } catch (error) {
        res.json({ error: "review not added" });
        return;
      }

      if (result.modifiedCount !== 1) {
        console.error("Book not found or review not added");
        res.json({ error: "Book not found or review not added" });
        return;
      }

      console.log("Review added successfully");
      res.json({ message: "Review added successfully" });
    });

    app.get("/review/:id", async (req, res) => {
      const bookId = req.params.id;

      const result = await bookCollection.findOne(
        { _id: ObjectId(bookId) },
        { projection: { _id: 0, reviews: 1 } }
      );

      if (result) {
        res.json(result);
      } else {
        res.status(404).json({ error: "Book not found" });
      }
    });

    app.post("/myList/:list", async (req, res) => {
      const data = req.body;
      const list = req.params.list;

      try {
        if (list === "wishlist" || list === "reading" || list === "completed") {
          const exist = await myListCollection.findOne(data);

          if (!exist) {
            const result = await myListCollection.insertOne({
              ...data,
              list,
            });
            res.send(result);
          } else {
            // Update the existing document in the collection
            await myListCollection.updateOne(
              { _id: exist._id },
              { $set: { list } }
            );
            res.send(exist);
            return; // Terminate the function execution
          }
        } else {
          res.send({ status: false });
        }
      } catch (error) {
        res.send({ status: false });
      }
    });

    app.get("/myList", async (req, res) => {
      const { list, uid } = req.query;
      try {
        if (list === "wishlist" || list === "reading" || list === "completed") {
          const books = await myListCollection
            .aggregate([
              {
                $match: { list, uid },
              },
              {
                $lookup: {
                  from: "book",
                  let: { bookId: { $toObjectId: "$bookId" } }, // Convert bookId to ObjectId
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", { $toObjectId: "$$bookId" }] }, // Perform the lookup using ObjectId
                      },
                    },
                  ],
                  as: "bookData",
                },
              },
              {
                $addFields: {
                  book: { $arrayElemAt: ["$bookData", 0] },
                },
              },
              {
                $project: {
                  uid: 0,
                  bookId: 0,
                  list: 0,
                  bookData: 0,
                },
              },
              {
                $project: {
                  "book._id": 1,
                  "book.title": 1,
                  "book.author": 1,
                  "book.genre": 1,
                  "book.publicationDate": 1,
                  // "book.addedBy": 1,
                },
              },
            ])
            .sort({ _id: -1 })
            .toArray();

          res.send({ status: true, data: books });
        } else {
          res.send({ status: false });
        }
      } catch (error) {
        console.error(error);
        res.send({ status: false });
      }
    });
  } finally {
  }
};

run().catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
